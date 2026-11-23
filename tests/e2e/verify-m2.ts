// M2 的 Chrome 實機驗證（§9 M2 完成標準、§10.3 標為 M2 的項目）。
//
//   pnpm build && pnpm verify:m2
//
// 和 verify-m1.ts 一樣用 CDP 驅動臨時設定檔的 Chrome。DLsite 頁面全部由 CDP 回應假的 HTML
// （結構照 2026-11-23 實測的 DLsite 寫），不會連到 DLsite，也不會真的加入購物車。
// 背景查價（商品 API）也由 CDP 回應 `[]`，整個流程不發出任何對外請求。
// 環境變數：CHROME_PATH、HEADLESS=0（同 verify-m1.ts）。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { Cdp, evaluate, poll, sleep } from './cdp.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const EXT_DIR = join(ROOT, '.output/chrome-mv3');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const results: { name: string; ok: boolean; detail: string }[] = [];
function record(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function note(name: string, detail: string) {
  console.log(`ℹ ${name} — ${detail}`);
}

// ---------------- 假的 DLsite 頁面 ----------------

const page = (body: string) =>
  `<!doctype html><meta charset="utf-8"><title>fake DLsite</title><body>${body}<script>` +
  // 頁面自己的腳本：擋掉連結導覽（真的 DLsite 由 JS 處理加入購物車），並提供「頁面腳本偽造點擊」的入口
  `document.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); });` +
  `</script>`;

const FAKE: Record<string, string> = {
  // 作品頁：本身的按鈕沒有 href；推薦區是列表樣式的連結
  '/home/work/=/product_id/RJ01014447.html': page(
    `<button class="button_cart btn_cart" data-ga4-ref="cart_add" id="main" style="width:200px;height:40px">カートに入れる</button>` +
      `<div class="work_btn_box"><ul class="work_btn_list"><li class="work_btn_list_item"><p class="work_cart_xs">` +
      `<a href="/home/cart/=/product_id/RJ01760999.html" class="btn_cart" id="rec" style="display:inline-block;width:200px;height:40px">カートに入れる</a>` +
      `</p></li></ul></div>` +
      `<a href="/home/cart/=/product_id/RJ00000002.html" class="btn_cart" id="forged" style="display:inline-block;width:200px;height:40px">偽造</a>` +
      `<a href="/home/cart/=/product_id/RJ00000003.html" class="btn_cart" id="after-push" style="display:inline-block;width:200px;height:40px">pushState 後</a>`,
  ),
  // 購物車頁：推薦區也有 data-product_id，不能被讀進來
  '/home/cart/': page(
    `<ul class="cart_list">` +
      `<li class="cart_list_item _cart_items" data-workno="RJ01014447" data-product-id="RJ01014447">a</li>` +
      `<li class="cart_list_item _cart_items" data-workno="RJ123456" data-product-id="RJ123456">b</li>` +
      `<li class="cart_list_item _cart_items" data-product-id="__proto__">c</li>` +
      `</ul><ul class="swiper-wrapper"><li><div data-product_id="RJ999999" data-product-id="RJ999999">rec</div></li></ul>`,
  ),
  '/home/mypage/': page('<p>mypage</p>'),
  '/home/pay/member/=/relayout/cart/buynow/1/product_id/RJ01014447/': page('<p>pay</p>'),
};

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'dl-assistant-verify-m2-'));
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

  try {
    note('Chrome', String((await cdp.send('Browser.getVersion')).product));
    const extId = String((await cdp.send('Extensions.loadUnpacked', { path: EXT_DIR })).id);
    const EXT = `chrome-extension://${extId}`;

    // ---- 攔截：DLsite 頁面回假 HTML、商品 API 回 []；其他一律擋下並記錄 ----
    const intercept = async (sessionId: string) => {
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
    };
    cdp.on((e) => {
      if (e.method !== 'Fetch.requestPaused') return;
      const req = e.params.request as { url: string };
      const u = new URL(req.url);
      const reply = (status: number, type: string, body: string) =>
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
        reply(200, 'application/json', '[]');
      } else if (u.host === 'www.dlsite.com' && Object.hasOwn(FAKE, u.pathname)) {
        reply(200, 'text/html; charset=utf-8', FAKE[u.pathname]!);
      } else {
        if (u.pathname !== '/favicon.ico') realRequests.push(req.url); // favicon 是瀏覽器自己抓的
        void cdp
          .send('Fetch.failRequest', { requestId: e.params.requestId, errorReason: 'BlockedByClient' }, e.sessionId)
          .catch(() => undefined);
      }
    });

    const findSw = () =>
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
    const attachSw = async () => {
      const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId: await findSw(), flatten: true })) as { sessionId: string };
      await intercept(sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      // 記下 content script 訊息的 sender.url（§10.3 pushState）
      await evaluate(
        cdp,
        sessionId,
        `globalThis.__m2 = []; chrome.runtime.onMessage.addListener((m, s) => { if (m && (m.type === 'cartClicked' || m.type === 'cartSnapshot')) __m2.push({ type: m.type, id: m.id, url: s.url, documentId: s.documentId }); }); true`,
      );
      return sessionId;
    };
    let sw = await attachSw();

    // ---- 分頁 ----
    const openTab = async (url = 'about:blank') => {
      const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
      const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
      await intercept(sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      if (url !== 'about:blank') await cdp.send('Page.navigate', { url }, sessionId);
      return sessionId;
    };
    const contexts = new Map<string, { id: number; name: string; auxData?: { type?: string } }[]>();
    cdp.on((e) => {
      if (e.method === 'Runtime.executionContextCreated' && e.sessionId) {
        const list = contexts.get(e.sessionId) ?? [];
        list.push(e.params.context as { id: number; name: string; auxData?: { type?: string } });
        contexts.set(e.sessionId, list);
      }
      if (e.method === 'Runtime.executionContextsCleared' && e.sessionId) contexts.set(e.sessionId, []);
    });
    const contentContext = (s: string) => contexts.get(s)?.find((c) => c.auxData?.type === 'isolated' && c.name === 'DL_Assistant');
    const waitContent = (s: string) => poll(async () => contentContext(s), 10_000, 'content script context');
    const loadAndWait = async (s: string, url: string) => {
      contexts.set(s, []);
      await cdp.send('Page.navigate', { url }, s);
      await poll(async () => ((await evaluate(cdp, s, `document.readyState === 'complete'`)) ? true : undefined), 10_000, 'page load');
    };
    const trustedClick = async (s: string, selector: string) => {
      const r = (await evaluate(
        cdp,
        s,
        `(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`,
      )) as { x: number; y: number };
      for (const type of ['mousePressed', 'mouseReleased'])
        await cdp.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }, s);
    };

    const ext = await openTab(`${EXT}/popup.html`);
    await poll(async () => ((await evaluate(cdp, ext, `!!document.querySelector('input')`)) ? true : undefined), 15_000, 'popup');
    const store = async () =>
      (await evaluate(cdp, ext, `chrome.storage.local.get(['items', 'lastCart', 'dailyAutoAdd'])`)) as {
        items?: { id: string; source: string; autoAdded: boolean }[];
        lastCart?: { ids: string[] };
        dailyAutoAdd?: { count: number; skipped: number };
      };
    const itemIds = async () => ((await store()).items ?? []).map((i) => i.id).sort();

    // ---- 作品頁：頁面腳本偽造的點擊不會加入（§3.2.4）----
    const work = await openTab();
    await loadAndWait(work, 'https://www.dlsite.com/home/work/=/product_id/RJ01014447.html');
    await waitContent(work);
    await evaluate(
      cdp,
      work,
      `document.getElementById('forged').click(); document.getElementById('main').click(); document.getElementById('main').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 })); true`,
    );
    await sleep(1000);
    record('頁面腳本偽造的點擊（isTrusted: false）不會加入追蹤（M2）', (await itemIds()).length === 0, JSON.stringify(await itemIds()));

    // ---- F1：使用者點擊加入購物車 → 追蹤清單多一筆 ----
    await trustedClick(work, '#main');
    const afterMain = await poll(
      async () => ((await itemIds()).includes('RJ01014447') ? await store() : undefined),
      10_000,
      'RJ01014447 added',
    ).catch(() => store());
    const main = afterMain.items?.find((i) => i.id === 'RJ01014447');
    record(
      '在作品頁按「カートに入れる」後追蹤清單自動多一筆（F1，按鈕沒有 href，用頁面網址）',
      main?.source === 'cart' && main.autoAdded === true,
      JSON.stringify(main),
    );
    await trustedClick(work, '#rec');
    const rec = await poll(async () => ((await itemIds()).includes('RJ01760999') ? true : undefined), 10_000, 'RJ01760999 added').catch(
      () => false,
    );
    record('推薦區（列表樣式）的按鈕從 href 取編號（F1）', rec === true, JSON.stringify(await itemIds()));

    // ---- §10.3 sender.url 在 history.pushState 之後 ----
    await evaluate(cdp, work, `history.pushState({}, '', '/home/cart/'); true`);
    await trustedClick(work, '#after-push');
    await sleep(800);
    const senders = (await evaluate(cdp, sw, `__m2`)) as { type: string; id?: string; url: string }[];
    const pushed = senders.find((s) => s.id === 'RJ00000003');
    note(
      'history.pushState 之後的 sender.url（§10.3）',
      pushed ? `${pushed.url}（${pushed.url.endsWith('/home/cart/') ? '會跟著改變' : '不會改變'}）` : '沒有收到訊息',
    );

    // ---- §10.3 onMessage 非同步回應：service worker 冷啟動 ----
    await cdp.send('ServiceWorker.enable', {}, ext).catch(() => undefined);
    const stopped = await cdp
      .send('ServiceWorker.stopAllWorkers', {}, ext)
      .then(() => true)
      .catch((e: unknown) => String(e));
    await sleep(1000);

    // ---- F2：購物車頁同步（service worker 停止後由訊息喚醒）----
    const cart = await openTab();
    await loadAndWait(cart, 'https://www.dlsite.com/home/cart/');
    await waitContent(cart);
    const afterCart = await poll(async () => ((await store()).lastCart ? await store() : undefined), 15_000, 'lastCart').catch(() =>
      store(),
    );
    record(
      '打開購物車頁時把頁面上的作品補進追蹤清單，推薦區與不合格的編號不算（F2）',
      ['RJ01014447', 'RJ123456'].every((id) => afterCart.items?.some((i) => i.id === id)) &&
        !afterCart.items?.some((i) => i.id === 'RJ999999') &&
        JSON.stringify(afterCart.lastCart?.ids) === JSON.stringify(['RJ01014447', 'RJ123456']),
      `lastCart=${JSON.stringify(afterCart.lastCart?.ids)}; items=${JSON.stringify(await itemIds())}`,
    );
    record(
      'service worker 停止後，content script 的訊息會喚醒它並正常處理（§10.3 冷啟動）',
      stopped === true && !!afterCart.lastCart,
      `stopAllWorkers=${String(stopped)}`,
    );
    sw = await attachSw();

    // 重新整理同一頁（新的 documentId）不會重複加入；同一份文件也只接受一次 —— 由單元測試涵蓋
    record(
      '每日計數只算新加入的作品（§3.2.4）',
      (await store()).dailyAutoAdd?.count === (await itemIds()).length,
      JSON.stringify((await store()).dailyAutoAdd),
    );

    // ---- 排除路徑：結帳、帳號頁沒有 content script（§3.2.5）----
    for (const url of [
      'https://www.dlsite.com/home/mypage/',
      'https://www.dlsite.com/home/pay/member/=/relayout/cart/buynow/1/product_id/RJ01014447/',
    ]) {
      const t = await openTab();
      await loadAndWait(t, url);
      await sleep(1500);
      record(`排除路徑不注入 content script：${new URL(url).pathname.slice(0, 40)}`, contentContext(t) === undefined);
    }

    // ---- popup 顯示「自動加入」----
    await cdp.send('Page.reload', {}, ext);
    await sleep(1500);
    const labels = (await evaluate(
      cdp,
      ext,
      `[...document.querySelectorAll('[data-testid="auto-added"]')].map((e) => e.textContent)`,
    )) as string[];
    record(
      'popup 的追蹤清單標示「自動加入」（F1／F2）',
      labels.length >= 3 && labels.every((l) => l === '自動加入'),
      JSON.stringify(labels),
    );

    record(
      '沒有需要擋下的對外請求（DLsite 頁面與商品 API 全部由 CDP 回應）',
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
