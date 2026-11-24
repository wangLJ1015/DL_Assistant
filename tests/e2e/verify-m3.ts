// M3 的 Chrome 實機驗證（§9 M3 完成標準、§10.3 標為 M3 的項目）。
//
//   pnpm build && pnpm verify:m3
//
// 商品 API 與 DLWatcher 全部由 CDP 回應假的資料（DLWatcher 用 tests/fixtures 的實測回應改編號），
// 不發出任何對外請求。最後一項（一直不回應的請求）不附加到 service worker（附加 CDP 會讓它不被終止），
// 改在瀏覽器層級攔截；攔截不到時那一項記為未確認。
// 環境變數：CHROME_PATH、HEADLESS=0（同 verify-m1.ts）。
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { Cdp, evaluate, poll, sleep } from './cdp.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const EXT_DIR = join(ROOT, '.output/chrome-mv3');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PRODUCT = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/product-info-RJ01014447-RJ99999999.json'), 'utf8')) as Record<
  string,
  unknown
>;
const DLW = readFileSync(join(ROOT, 'tests/fixtures/dlwatcher-RJ01014447.json'), 'utf8');

const results: { name: string; ok: boolean; detail: string }[] = [];
function record(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function note(name: string, detail: string) {
  console.log(`ℹ ${name} — ${detail}`);
}

const productFor = (ids: string[]) => JSON.stringify(Object.fromEntries(ids.map((id) => [id, PRODUCT.RJ01014447])));
const dlwFor = (id: string) => DLW.replace('"productId": "RJ01014447"', `"productId": "${id}"`);
const ids = (n: number, from: number) => Array.from({ length: n }, (_, i) => `RJ${String(from + i).padStart(8, '0')}`);

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'dl-assistant-verify-m3-'));
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-features=MediaRouter,OptimizationHints',
    'about:blank',
  ];
  if (process.env.HEADLESS !== '0') args.unshift('--headless=new');
  const child = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stdio[2]!.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  const cdp = new Cdp(child.stdio[3] as Writable, child.stdio[4] as Readable);
  const realRequests: string[] = [];
  /** DLWatcher 被請求的作品（依序）。 */
  const dlwRequests: string[] = [];
  /** 這些作品的第一個 DLWatcher 請求一直不回應。 */
  const holdOnce = new Set<string>();

  try {
    note('Chrome', String((await cdp.send('Browser.getVersion')).product));
    const extId = String((await cdp.send('Extensions.loadUnpacked', { path: EXT_DIR })).id);
    const EXT = `chrome-extension://${extId}`;

    const onPaused = (e: { params: Record<string, unknown>; sessionId?: string }) => {
      const req = e.params.request as { url: string };
      const u = new URL(req.url);
      const fulfill = (status: number, type: string, body: string) =>
        void cdp
          .send(
            'Fetch.fulfillRequest',
            {
              requestId: e.params.requestId,
              responseCode: status,
              responseHeaders: [{ name: 'Content-Type', value: type }],
              body: Buffer.from(body).toString('base64'),
            },
            e.sessionId,
          )
          .catch(() => undefined);
      if (u.protocol === 'chrome-extension:') {
        void cdp.send('Fetch.continueRequest', { requestId: e.params.requestId }, e.sessionId).catch(() => undefined);
      } else if (u.host === 'www.dlsite.com' && u.pathname === '/maniax/product/info/ajax') {
        fulfill(200, 'application/json', productFor((u.searchParams.get('product_id') ?? '').split(',')));
      } else if (u.host === 'dlwatcher.com' && /^\/product\/[A-Z]{2}\d+\.json$/.test(u.pathname)) {
        const id = u.pathname.slice('/product/'.length, -'.json'.length);
        dlwRequests.push(id);
        if (!holdOnce.delete(id)) fulfill(200, 'application/json', dlwFor(id));
      } else if (u.host === 'img.dlsite.jp') {
        // popup 的作品縮圖：回 1×1 GIF，不連到 DLsite
        void cdp
          .send(
            'Fetch.fulfillRequest',
            {
              requestId: e.params.requestId,
              responseCode: 200,
              responseHeaders: [{ name: 'Content-Type', value: 'image/gif' }],
              body: 'R0lGODlhAQABAAAAACw=',
            },
            e.sessionId,
          )
          .catch(() => undefined);
      } else {
        realRequests.push(req.url);
        void cdp
          .send('Fetch.failRequest', { requestId: e.params.requestId, errorReason: 'BlockedByClient' }, e.sessionId)
          .catch(() => undefined);
      }
    };
    cdp.on((e) => {
      if (e.method === 'Fetch.requestPaused') onPaused(e);
    });
    const intercept = (sessionId?: string) => cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);

    const swTarget = () =>
      poll(
        async () => {
          const { targetInfos } = (await cdp.send('Target.getTargets')) as {
            targetInfos: { targetId: string; type: string; url: string }[];
          };
          return targetInfos.find((t) => t.type === 'service_worker' && t.url === `${EXT}/background.js`)?.targetId;
        },
        15_000,
        'service worker target',
      );
    let swSession: string | undefined;
    const attachSw = async () => {
      const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId: await swTarget(), flatten: true })) as {
        sessionId: string;
      };
      await intercept(sessionId);
      swSession = sessionId;
    };
    // service worker 每次重新啟動都是新的 target：自動附加並攔截（第 4 項之前）
    let autoAttach = true;
    cdp.on((e) => {
      if (e.method !== 'Target.targetCreated' || !autoAttach) return;
      const info = e.params.targetInfo as { targetId: string; type: string; url: string };
      if (info.type === 'service_worker' && info.url === `${EXT}/background.js`) void attachSw().catch(() => undefined);
    });
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    await attachSw();

    const openTab = async (url: string) => {
      const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
      const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
      await intercept(sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.navigate', { url }, sessionId);
      return sessionId;
    };
    const ext = await openTab(`${EXT}/popup.html`);
    await poll(async () => ((await evaluate(cdp, ext, `!!document.querySelector('input')`)) ? true : undefined), 15_000, 'popup');
    const send = (msg: unknown) => evaluate(cdp, ext, `chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
    const local = (keys: string[]) =>
      evaluate(cdp, ext, `chrome.storage.local.get(${JSON.stringify(keys)})`) as Promise<Record<string, unknown>>;
    const histories = () =>
      evaluate(
        cdp,
        ext,
        `new Promise((res, rej) => { const r = indexedDB.open('dl-assistant'); r.onerror = () => rej(r.error); r.onsuccess = () => { const db = r.result; const g = db.transaction('history').objectStore('history').getAll(); g.onsuccess = () => { res(g.result.map((h) => ({ id: h.id, lowest: h.lowest }))); db.close(); }; }; })`,
      ) as Promise<{ id: string; lowest: { price: number; start: string; end: string } | null }[]>;
    const queueLeft = async () => {
      const q = (await local(['queues'])).queues as { dlwatcher: { ids: string[]; nextIndex: number } } | undefined;
      return q ? q.dlwatcher.ids.length - q.dlwatcher.nextIndex : 0;
    };

    // ---- 1. 每個追蹤作品都有史低和期間 ----
    const first = ids(3, 1014447);
    for (const id of first) await send({ type: 'track', id, from: 'manual' });
    const hist = await poll(
      async () => {
        const h = await histories();
        return first.every((id) => h.some((x) => x.id === id && x.lowest)) ? h : undefined;
      },
      30_000,
      'history for every tracked work',
    ).catch(() => histories());
    record(
      '每個追蹤作品都有史低和期間（DLWatcher → IndexedDB history）',
      first.every((id) => hist.find((h) => h.id === id)?.lowest?.price === 990),
      JSON.stringify(hist.map((h) => [h.id, h.lowest?.price, h.lowest?.start.slice(0, 10), h.lowest?.end.slice(0, 10)])),
    );
    await poll(
      async () =>
        (await evaluate(cdp, ext, `document.querySelectorAll('[data-testid="lowest-dlwatcher"]').length`)) === 3 ? true : undefined,
      10_000,
      'popup lowest',
    ).catch(() => undefined);
    const shown = (await evaluate(
      cdp,
      ext,
      `[...document.querySelectorAll('[data-testid="lowest"]')].map((e) => e.textContent)`,
    )) as string[];
    record(
      'popup 並列顯示 DLWatcher 史低與自己紀錄的最低價（§3.6）',
      shown.length === 3 && shown.every((t) => t.includes('史低 ¥990') && t.includes('自己的紀錄 ¥1,386')),
      shown[0] ?? 'none',
    );

    // ---- 2. 關閉 DLWatcher：史低改用自己的紀錄 ----
    await evaluate(
      cdp,
      ext,
      `document.querySelector('details').open = true; document.querySelector('[data-testid="dlwatcher-enabled"]').click(); true`,
    );
    const own = await poll(
      async () => {
        const r = (await evaluate(
          cdp,
          ext,
          `({ dlw: document.querySelectorAll('[data-testid="lowest-dlwatcher"]').length, own: [...document.querySelectorAll('[data-testid="lowest-own"]')].map((e) => e.textContent) })`,
        )) as { dlw: number; own: string[] };
        return r.dlw === 0 && r.own.length === 3 ? r : undefined;
      },
      10_000,
      'own lowest',
    ).catch(() => undefined);
    const settings = (await local(['settings'])).settings as { dlwatcherEnabled?: boolean } | undefined;
    record(
      '在設定關閉 DLWatcher 後，史低改用自己的紀錄（§3.6）',
      settings?.dlwatcherEnabled === false &&
        !!own &&
        own.own.every((t) => /^史低 ¥1,386（自 \d{4}-\d{2}-\d{2} 開始追蹤以來的最低價）$/.test(t)),
      own ? own.own[0]! : 'popup 沒有切換',
    );
    const before = dlwRequests.length;
    await send({ type: 'track', id: 'RJ01014450', from: 'manual' });
    await sleep(3000);
    record('關閉 DLWatcher 時新加入的作品不請求 DLWatcher', dlwRequests.length === before, `requests=${dlwRequests.length - before}`);

    // ---- 3. 查價途中 service worker 被終止，重啟後能接著做 ----
    await send({ type: 'setSettings', partial: { dlwatcherEnabled: true } });
    const batch = ids(10, 1500000);
    // 同時送出：商品 API 一批查完，DLWatcher 一件 2 秒，10 件要 20 秒
    await Promise.all(batch.map((id) => send({ type: 'track', id, from: 'manual' })));
    // 新加入的排在最前面：等 DLWatcher 處理了幾件再停
    await poll(
      async () => (batch.filter((id) => dlwRequests.includes(id)).length >= 3 ? true : undefined),
      30_000,
      'some dlwatcher requests',
    );
    await cdp.send('ServiceWorker.enable', {}, ext).catch(() => undefined);
    const stoppedAt = Date.now();
    const doneBeforeStop = batch.filter((id) => dlwRequests.includes(id)).length;
    const stopped = await cdp
      .send('ServiceWorker.stopAllWorkers', {}, ext)
      .then(() => true)
      .catch((e: unknown) => String(e));
    const leftAtStop = await queueLeft();
    // 不送任何訊息：靠 drain alarm 叫醒
    const finished = await poll(
      async () => ((await queueLeft()) === 0 && batch.every((id) => dlwRequests.includes(id)) ? Date.now() : undefined),
      120_000,
      'queue drained after restart',
    ).catch(() => undefined);
    const perId = batch.map((id) => dlwRequests.filter((x) => x === id).length);
    record(
      '查價途中 service worker 被終止，drain alarm 叫醒後從中斷處接著做（§4.1，M3 完成標準）',
      stopped === true && leftAtStop > 0 && finished !== undefined && perId.every((n) => n === 1),
      `停止時已完成 ${doneBeforeStop}/10、佇列剩 ${leftAtStop}；${finished ? `停止後 ${Math.round((finished - stoppedAt) / 1000)} 秒做完` : '沒有做完'}；每件請求次數 ${JSON.stringify(perId)}`,
    );

    // ---- 4. 一直不回應的請求：30 秒後放棄，稍後重試（§4.1）----
    // §10.3「單純等待 fetch 回應算不算活動」2026-11-23 另外量過（Chrome 157：清掉 drain alarm、請求 75 秒不回應，
    // service worker 沒有被終止）；Chrome 文件寫超過 30 秒可能被終止，所以 apiGet 30 秒逾時，不依賴這個行為。
    autoAttach = false;
    if (swSession) await cdp.send('Target.detachFromTarget', { sessionId: swSession }).catch(() => undefined);
    await intercept(); // 瀏覽器層級
    const held = 'RJ01600000';
    holdOnce.add(held);
    const t0 = Date.now();
    await send({ type: 'track', id: held, from: 'manual' });
    const heldSeen = await poll(async () => (dlwRequests.includes(held) ? true : undefined), 20_000, 'held request').catch(() => false);
    if (!heldSeen) {
      note('一直不回應的請求', '瀏覽器層級攔截不到 service worker 的請求，這一項未確認（沒有送出真的請求）');
    } else {
      const saved = await poll(
        async () => ((await histories()).some((h) => h.id === held) ? Date.now() : undefined),
        180_000,
        'held work eventually saved',
      ).catch(() => undefined);
      const attempts = dlwRequests.filter((x) => x === held).length;
      record(
        'DLWatcher 一直不回應時 30 秒後放棄，稍後重試並存好（§4.1）',
        saved !== undefined && attempts === 2 && saved - t0 >= 30_000,
        saved ? `請求 ${attempts} 次，${Math.round((saved - t0) / 1000)} 秒後存好` : `請求 ${attempts} 次，沒有存好`,
      );
    }

    record(
      '沒有需要擋下的對外請求（商品 API、DLWatcher 全部由 CDP 回應）',
      realRequests.length === 0,
      realRequests.slice(0, 3).join(' | ') || 'none',
    );
  } finally {
    try {
      await cdp.send('Browser.close');
    } catch {
      child.kill();
    }
    await new Promise((r) => child.once('exit', r));
    await sleep(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    if (stderr) console.log(`--- chrome stderr (tail) ---\n${stderr.slice(-2000)}`);
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
