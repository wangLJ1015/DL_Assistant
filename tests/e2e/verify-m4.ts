// M4 的 Chrome 實機驗證（§9 M4 完成標準、§10.3 標為 M4 的項目）。
//
//   pnpm build && pnpm verify:m4
//
// 商品 API 由 CDP 依每件作品的「目前價格」回應假的資料，DLWatcher 回 404（自動暫停那一項回壞掉的 JSON），
// 不發出任何對外請求。每一次「查價」是讓真正的 `check` alarm 觸發（startRun → 佇列 → §6.1 → 通知），
// 再用 chrome.notifications.getAll() 確認系統通知真的建立了。
// 第二部分（§10.3「storage.local.set 多個 key 是否不可分割」）：一直用一次 set 寫兩個 key，中途強制結束整個 Chrome
// （taskkill /F /T），用同一個 profile 重開後檢查兩個 key 的版本一致，重複數次。
// 環境變數：CHROME_PATH、HEADLESS=0（同 verify-m1.ts）、M4_PART=notify 或 atomic（只跑一部分）。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { attachServiceWorker, Cdp, closeChrome, evaluate, killChrome, poll, sleep, watchdog } from './cdp.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const EXT_DIR = join(ROOT, '.output/chrome-mv3');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PRODUCT = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/product-info-RJ01014447-RJ99999999.json'), 'utf8')) as Record<
  string,
  Record<string, unknown>
>;

const results: { name: string; ok: boolean; detail: string }[] = [];
function record(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function note(name: string, detail: string) {
  console.log(`ℹ ${name} — ${detail}`);
}

interface Price {
  price: number;
  campaign?: string;
  /** JST "YYYY-MM-DD HH:mm:ss" */
  end?: string;
}
/** 每件作品目前的價格；不在這裡的作品不出現在回應裡（查不到）。 */
const prices = new Map<string, Price>();
const OFFICIAL = 1980;

function productFor(reqIds: string[]): string {
  const out: Record<string, unknown> = {};
  for (const id of reqIds) {
    const p = prices.get(id);
    if (!p) continue;
    const e: Record<string, unknown> = { ...PRODUCT.RJ01014447, work_name: `テスト作品 ${id}`, price: p.price, official_price: OFFICIAL };
    delete e.campaign_id;
    delete e.discount_rate;
    delete e.discount_end_date;
    e.is_discount = p.price < OFFICIAL;
    if (p.price < OFFICIAL) e.discount_rate = Math.round((1 - p.price / OFFICIAL) * 100);
    if (p.campaign) e.campaign_id = p.campaign;
    if (p.end) e.discount_end_date = p.end;
    out[id] = e;
  }
  return Object.keys(out).length === 0 ? '[]' : JSON.stringify(out);
}

/** 目前的 Chrome（watchdog 逾時時強制結束它）。 */
let currentChild: ChildProcess | undefined;

function launch(profile: string): { child: ChildProcess; cdp: Cdp; stderr: () => string } {
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
  currentChild = child;
  let err = '';
  child.stdio[2]!.on('data', (d: Buffer) => {
    err += d.toString();
  });
  return { child, cdp: new Cdp(child.stdio[3] as Writable, child.stdio[4] as Readable), stderr: () => err };
}

// ---------------- 第一部分：通知 ----------------

async function notificationsPart() {
  const profile = mkdtempSync(join(tmpdir(), 'dl-assistant-verify-m4-'));
  const { child, cdp } = launch(profile);
  const realRequests: string[] = [];
  let productRequests = 0;
  let dlwMode: '404' | 'broken' = '404';
  try {
    note('Chrome', String((await cdp.send('Browser.getVersion')).product));
    const extId = String((await cdp.send('Extensions.loadUnpacked', { path: EXT_DIR })).id);
    const EXT = `chrome-extension://${extId}`;

    cdp.on((e) => {
      if (e.method !== 'Fetch.requestPaused') return;
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
        productRequests++;
        fulfill(200, 'application/json', productFor((u.searchParams.get('product_id') ?? '').split(',')));
      } else if (u.host === 'dlwatcher.com' && /^\/product\/[A-Z]{2}\d+\.json$/.test(u.pathname)) {
        if (dlwMode === 'broken') fulfill(200, 'application/json', '{"broken":true}');
        else fulfill(404, 'text/html', '<html>404</html>');
      } else if (u.host === 'img.dlsite.jp') {
        fulfill(200, 'image/gif', 'GIF89a');
      } else {
        realRequests.push(req.url);
        void cdp
          .send('Fetch.failRequest', { requestId: e.params.requestId, errorReason: 'BlockedByClient' }, e.sessionId)
          .catch(() => undefined);
      }
    });
    const intercept = (sessionId?: string) => cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);

    const attach = async (targetId: string) => {
      const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
      await intercept(sessionId);
      return sessionId;
    };
    // 等到 chrome.storage 可以用才回傳（剛載入時 service worker 可能還在啟動，cdp.ts 的 attachServiceWorker）
    let sw = await attachServiceWorker(cdp, EXT, { onAttach: intercept });
    // service worker 重新啟動時是新的 target：自動附加並攔截
    cdp.on((e) => {
      if (e.method !== 'Target.targetCreated') return;
      const info = e.params.targetInfo as { targetId: string; type: string; url: string };
      if (info.type === 'service_worker' && info.url === `${EXT}/background.js`)
        void attach(info.targetId)
          .then((s) => {
            sw = s;
          })
          .catch(() => undefined);
    });
    await cdp.send('Target.setDiscoverTargets', { discover: true });

    const { targetId: tabId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    const ext = await attach(tabId);
    await cdp.send('Runtime.enable', {}, ext);
    await cdp.send('Page.navigate', { url: `${EXT}/popup.html` }, ext);
    await poll(async () => ((await evaluate(cdp, ext, `!!document.querySelector('input')`)) ? true : undefined), 15_000, 'popup');

    const send = (msg: unknown) => evaluate(cdp, ext, `chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
    const local = (keys: string[]) =>
      evaluate(cdp, ext, `chrome.storage.local.get(${JSON.stringify(keys)})`) as Promise<Record<string, unknown>>;
    const swEval = (expr: string) => evaluate(cdp, sw, expr);
    const systemNotifications = async () => Object.keys((await swEval('chrome.notifications.getAll()')) as Record<string, unknown>);
    type Recent = { notificationId: string; ids: string[]; rules: string[]; text: string };
    const recent = async () => ((await local(['recentNotifications'])).recentNotifications ?? []) as Recent[];
    const queueIdle = async () => {
      const q = (await local(['queues'])).queues as { productInfo: { ids: string[]; nextIndex: number } } | undefined;
      return !q || q.productInfo.nextIndex >= q.productInfo.ids.length;
    };

    /** 讓 `check` alarm 觸發一輪查價，等商品 API 這一輪做完。 */
    const runCheck = async (what: string) => {
      const before = productRequests;
      await swEval(`chrome.alarms.create('check', { when: Date.now() + 50 }).then(() => true)`);
      await poll(async () => (productRequests > before && (await queueIdle()) ? true : undefined), 30_000, `check run: ${what}`);
      await sleep(500);
    };

    note('通知權限', String(await swEval(`new Promise((r) => chrome.notifications.getPermissionLevel(r))`)));

    // ---- 1. 作品打折時收到一次通知；回到原價後再次打折會再通知 ----
    const A = 'RJ01014447';
    prices.set(A, { price: OFFICIAL });
    await send({ type: 'track', id: A, from: 'manual' });
    const baseline = await poll(
      async () => {
        const items = (await local(['items'])).items as { id: string; baselineAt?: string }[] | undefined;
        return items?.find((i) => i.id === A)?.baselineAt;
      },
      15_000,
      'baseline',
    ).catch(() => undefined);
    record(
      '第一次查價只建立基準（baselineAt），不通知（§6.1 第 6 步）',
      !!baseline && (await recent()).length === 0,
      baseline ?? 'no baseline',
    );

    prices.set(A, { price: 990, campaign: 'c1', end: '2027-01-05 23:59:59' });
    await runCheck('sale c1');
    const sys1 = await systemNotifications();
    const r1 = await recent();
    record(
      '作品打折時收到一次通知（chrome.notifications 真的建立）',
      r1.length === 1 && sys1.includes(r1[0]!.notificationId) && r1[0]!.rules.join() === 'sale,lowest',
      `system=${sys1.length} recent=${JSON.stringify(r1.map((r) => [r.rules, r.text]))}`,
    );
    await runCheck('same sale');
    record('同一段優惠再查價不重發', (await recent()).length === 1 && (await systemNotifications()).length === 1);
    prices.set(A, { price: OFFICIAL });
    await runCheck('regular');
    prices.set(A, { price: 990, campaign: 'c2', end: '2027-01-20 23:59:59' });
    await runCheck('sale c2');
    const r2 = await recent();
    record(
      '回到原價後再次打折會再通知',
      r2.length === 2 && (await systemNotifications()).includes(r2[0]!.notificationId),
      `recent=${r2.length}`,
    );

    // ---- 2. 一批多件合併成一則 ----
    const batch = ['RJ01014448', 'RJ01014449', 'RJ01014450'];
    for (const id of batch) prices.set(id, { price: OFFICIAL });
    for (const id of batch) await send({ type: 'track', id, from: 'manual' });
    await poll(
      async () => {
        const items = (await local(['items'])).items as { id: string; baselineAt?: string }[];
        return batch.every((id) => items.some((i) => i.id === id && i.baselineAt)) ? true : undefined;
      },
      30_000,
      'batch baseline',
    );
    const beforeBatch = (await recent()).length;
    for (const id of batch) prices.set(id, { price: 1386, campaign: 'c3' });
    await runCheck('batch sale');
    const r3 = await recent();
    record(
      '同一批 3 件作品開始打折 → 只送一則合併通知（§6.1 第 9 步）',
      r3.length === beforeBatch + 1 && r3[0]!.ids.length === 3 && r3[0]!.text.startsWith('3 個追蹤作品正在特價'),
      JSON.stringify(r3[0]?.text),
    );

    // ---- 3. 查不到一次不重發（沒有 campaignId 與 discountEnd）----
    const B = batch[0]!;
    prices.set(B, { price: OFFICIAL });
    await runCheck('B regular');
    prices.set(B, { price: 1386 });
    await runCheck('B sale without campaign');
    const n3 = (await recent()).length;
    prices.delete(B);
    await runCheck('B unavailable');
    const snapB = ((await local(['snapshots'])).snapshots as { id: string; available: boolean; episode?: { key: string } }[]).find(
      (s) => s.id === B,
    );
    prices.set(B, { price: 1386 });
    await runCheck('B back');
    record(
      '沒有 campaignId 與 discountEnd 的打折作品，查不到一次後恢復 → 不重發',
      snapB?.available === false && !!snapB.episode && (await recent()).length === n3,
      `查不到時 episode=${snapB?.episode?.key}`,
    );

    // ---- 4. 暫停恢復、恢復時已經在打折 → 之後兩次查價都沒有通知 ----
    const C = batch[1]!;
    prices.set(C, { price: OFFICIAL });
    await runCheck('C regular');
    const n4 = (await recent()).length;
    await send({ type: 'setPaused', id: C, paused: true });
    prices.set(C, { price: 990, campaign: 'c4' });
    await runCheck('C paused');
    await send({ type: 'setPaused', id: C, paused: false });
    await sleep(2000);
    await runCheck('C resumed 1');
    await runCheck('C resumed 2');
    record(
      '暫停後恢復、恢復時已經在打折 → 恢復後連續兩次查價都沒有通知',
      (await recent()).length === n4,
      `recent ${n4} → ${(await recent()).length}`,
    );

    // ---- 5. 打折中把目標價調高到現價以上 → 不發 target ----
    const n5 = (await recent()).length;
    const reply = await send({ type: 'setTarget', id: A, price: 1200 });
    await runCheck('A target raised');
    record('在打折中把目標價調高到現價以上 → 不發 target', JSON.stringify(reply) === '{"ok":true}' && (await recent()).length === n5);

    // ---- 6. DLWatcher 自動暫停的系統通知（§3.6）----
    dlwMode = 'broken';
    const DAY = 86_400_000;
    await swEval(
      `chrome.storage.local.set({ dlwatcherHealth: { allFailingSince: new Date(Date.now() - 7 * ${DAY} - 60000).toISOString(), lastFailureAt: new Date(Date.now() - 60000).toISOString() }, dlwatcherLastRequest: [] }).then(() => true)`,
    );
    await runCheck('dlwatcher broken');
    const paused = await poll(
      async () => {
        const s = (await local(['settings'])).settings as { dlwatcherAutoPausedAt?: string } | undefined;
        return s?.dlwatcherAutoPausedAt;
      },
      30_000,
      'auto pause',
    ).catch(() => undefined);
    const r6 = await recent();
    const pausedNotice = r6.find((r) => r.rules.includes('dlwatcherPaused'));
    record(
      'DLWatcher 連續 7 天失敗 → 自動暫停並送出系統通知（§3.6）',
      !!paused && !!pausedNotice && (await systemNotifications()).includes(pausedNotice.notificationId),
      pausedNotice?.text ?? 'no notice',
    );

    record(
      '沒有需要擋下的對外請求（商品 API、DLWatcher 全部由 CDP 回應）',
      realRequests.length === 0,
      realRequests.slice(0, 3).join(' | ') || 'none',
    );
    note('通知點擊', 'CDP 無法點擊系統通知；點擊後開啟的網址由單元測試（tests/notifications.test.ts）確認');
  } finally {
    await closeChrome(child, cdp);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

// ---------------- 第二部分：storage.local.set 多個 key 是否不可分割（§10.3）----------------

async function atomicityPart() {
  const profile = mkdtempSync(join(tmpdir(), 'dl-assistant-verify-m4-atomic-'));
  const ROUNDS = 5;
  const rounds: string[] = [];
  let ok = true;
  let tested = 0;
  try {
    let extId: string | undefined;
    for (let round = 0; round < ROUNDS; round++) {
      const { child, cdp } = launch(profile);
      try {
        // CDP 載入的 unpacked 擴充功能重開後不會保留：每一輪重新載入（同一個路徑 → 同一個 ID，storage 留在 profile 裡）
        const id = String((await cdp.send('Extensions.loadUnpacked', { path: EXT_DIR })).id);
        if (extId && id !== extId) throw new Error(`extension id changed: ${extId} → ${id}`);
        extId = id;
        const EXT = `chrome-extension://${extId}`;
        // 重新載入後，service worker 的 target 可能還在啟動或被替換（附加上去時 `chrome` 還沒定義）：
        // attachServiceWorker 重試到 chrome.storage 可以用為止。
        const sessionId = await attachServiceWorker(cdp, EXT, { timeoutMs: 20_000 }).catch(() => undefined);
        if (!sessionId) {
          rounds.push(`第 ${round + 1} 輪：重開後找不到可用的 service worker`);
          ok = false;
          await closeChrome(child, cdp);
          break;
        }
        // 上一輪被強制結束前寫到哪一版
        const got = (await evaluate(cdp, sessionId, `chrome.storage.local.get(['atomA', 'atomB'])`)) as {
          atomA?: { v: number; pad: string };
          atomB?: { v: number; pad: string };
        };
        if (round > 0) {
          tested++;
          const a = got.atomA?.v;
          const b = got.atomB?.v;
          const same = a === b && got.atomA?.pad.length === got.atomB?.pad.length;
          if (!same) ok = false;
          rounds.push(`atomA=${a} atomB=${b}${same ? '' : ' ✗'}`);
          if (a === undefined) ok = false;
        }
        // 一直用一次 set 寫兩個 key（各約 1 MB），版本號遞增；隨機時間後強制結束整個 Chrome
        await evaluate(
          cdp,
          sessionId,
          `(() => { let v = ${round * 100_000}; const pad = 'x'.repeat(1_000_000); (async () => { for (;;) { v++; await chrome.storage.local.set({ atomA: { v, pad: pad + v }, atomB: { v, pad: pad + v } }); } })(); return true; })()`,
        );
        await sleep(1500 + Math.floor(Math.random() * 2000));
        await killChrome(child);
        await sleep(1000); // profile 的檔案鎖釋放後再重開
      } catch (e) {
        await killChrome(child);
        throw e;
      }
    }
    record(
      'storage.local.set 一次寫多個 key：寫入途中強制結束 Chrome，重開後兩個 key 一致（§10.3）',
      ok && tested === ROUNDS - 1,
      rounds.join('；'),
    );
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}

async function main() {
  // 整支腳本的上限（cdp.ts 的 watchdog）：超過就強制結束 Chrome 並以失敗結束，不會一直卡著
  const disarm = watchdog('verify-m4', 10 * 60_000, () => [currentChild]);
  // M4_PART=notify／atomic：只跑其中一部分（除錯用）
  const part = process.env.M4_PART;
  if (part !== 'atomic') await notificationsPart();
  if (part !== 'notify') await atomicityPart();
  disarm();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
