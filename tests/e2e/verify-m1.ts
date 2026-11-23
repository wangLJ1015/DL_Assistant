// M1 的 Chrome 實機驗證（§9 M1 完成標準、§10.3 標為 M1 的項目）。
//
//   pnpm build && pnpm verify:chrome
//
// 用 Node 內建功能透過 CDP（--remote-debugging-pipe）驅動 Chrome，不需要 puppeteer。
// - 使用臨時的 user-data-dir（結束後刪除），不碰你平常的 Chrome 資料，也沒有任何登入狀態。
// - Chrome 137 起正式版不支援 --load-extension，改用 CDP 的 Extensions.loadUnpacked。
// - 會實際呼叫一次 DLsite 商品 API（查 RJ01014447 的現價）。其他對外請求一律由 CDP 攔截，不會送出。
// 環境變數：CHROME_PATH（預設 C:\Program Files\Google\Chrome\Application\chrome.exe）、HEADLESS=0 顯示視窗。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { Cdp, evaluate, poll, sleep, type Json } from './cdp.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const EXT_DIR = join(ROOT, '.output/chrome-mv3');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEST_WORK = 'RJ01014447';

// ---------------- 結果紀錄 ----------------

const results: { name: string; ok: boolean; detail: string }[] = [];
function record(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const info: { name: string; detail: string }[] = [];
function note(name: string, detail: string) {
  info.push({ name, detail });
  console.log(`ℹ ${name} — ${detail}`);
}

// ---------------- 主流程 ----------------

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'dl-assistant-verify-'));
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

  try {
    const version = await cdp.send('Browser.getVersion');
    note('Chrome', String(version.product));

    // ---- 載入擴充功能：manifest（含 CSP、minimum_chrome_version、externally_connectable）是否被接受 ----
    let extId: string;
    try {
      const r = await cdp.send('Extensions.loadUnpacked', { path: EXT_DIR });
      extId = String(r.id);
      record('manifest 被 Chrome 接受（CSP、minimum_chrome_version、externally_connectable）', true, `extension id ${extId}`);
    } catch (e) {
      record('manifest 被 Chrome 接受', false, String(e));
      throw e;
    }
    const EXT = `chrome-extension://${extId}`;

    await cdp.send('Target.setDiscoverTargets', { discover: true });
    const swTargetId = await poll(
      async () => {
        const { targetInfos } = (await cdp.send('Target.getTargets')) as { targetInfos: { targetId: string; type: string; url: string }[] };
        return targetInfos.find((t) => t.type === 'service_worker' && t.url === `${EXT}/background.js`)?.targetId;
      },
      15_000,
      'service worker target',
    );
    const { sessionId: sw } = (await cdp.send('Target.attachToTarget', { targetId: swTargetId, flatten: true })) as { sessionId: string };

    // 收集所有 session 的錯誤與 CSP 違規
    const problems: string[] = [];
    cdp.on((e) => {
      if (e.method === 'Runtime.exceptionThrown')
        problems.push(`[${e.sessionId === sw ? 'sw' : 'page'}] exception: ${JSON.stringify(e.params).slice(0, 300)}`);
      if (e.method === 'Log.entryAdded') {
        const entry = e.params.entry as { level: string; text: string; url?: string };
        if (entry.level === 'error' || /Content Security Policy/i.test(entry.text))
          problems.push(`[${e.sessionId === sw ? 'sw' : 'page'}] log: ${entry.text}${entry.url ? ` (${entry.url})` : ''}`);
      }
      if (e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'warning')) {
        problems.push(
          `[${e.sessionId === sw ? 'sw' : 'page'}] console.${String(e.params.type)}: ${JSON.stringify(e.params.args).slice(0, 300)}`,
        );
      }
    });
    await cdp.send('Runtime.enable', {}, sw);
    await cdp.send('Log.enable', {}, sw);
    // 刻意觸發違規的區段：只有這些區段裡的錯誤不算進最後的 jitless 檢查
    const expectedWindows: [number, number][] = [];
    const expectProblems = async <T>(fn: () => Promise<T>): Promise<T> => {
      const start = problems.length;
      try {
        return await fn();
      } finally {
        await sleep(300);
        expectedWindows.push([start, problems.length]);
      }
    };

    // ---- §3.4：service worker 的呼叫環境檢查 ----
    const env = (await evaluate(
      cdp,
      sw,
      `({ isSW: typeof ServiceWorkerGlobalScope !== 'undefined' && globalThis instanceof ServiceWorkerGlobalScope, protocol: location.protocol })`,
    )) as { isSW: boolean; protocol: string };
    record(
      'service worker 的 ServiceWorkerGlobalScope 與 location.protocol 檢查成立（§3.4）',
      env.isSW && env.protocol === 'chrome-extension:',
      JSON.stringify(env),
    );

    // 記錄訊息的 sender（§10.3「擴充功能來源」）
    await evaluate(
      cdp,
      sw,
      `globalThis.__probeSenders = []; chrome.runtime.onMessage.addListener((m, s) => { if (m && m.__probe) __probeSenders.push({ probe: m.__probe, id: s.id === chrome.runtime.id, origin: s.origin, url: s.url, hasTab: !!s.tab }); }); true`,
    );

    // ---- 打開 popup.html（以分頁開啟），攔截白名單外的請求 ----
    const { targetId: popupTarget } = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    const { sessionId: pg } = (await cdp.send('Target.attachToTarget', { targetId: popupTarget, flatten: true })) as { sessionId: string };
    await cdp.send('Runtime.enable', {}, pg);
    await cdp.send('Log.enable', {}, pg);
    await cdp.send('Page.enable', {}, pg);
    // CDP 注入的腳本不受頁面 CSP 限制：在頁面腳本之前裝好 securitypolicyviolation 紀錄器
    await cdp.send(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI }));`,
      },
      pg,
    );
    const intercepted: { url: string; headers: Json }[] = [];
    await cdp.send(
      'Fetch.enable',
      {
        patterns: [
          { urlPattern: 'https://example.com/*' },
          { urlPattern: '*mypage/coupon*' },
          { urlPattern: 'https://dlwatcher.com/*' },
          { urlPattern: 'https://*.css' },
        ],
      },
      pg,
    );
    cdp.on((e) => {
      if (e.method !== 'Fetch.requestPaused' || e.sessionId !== pg) return;
      const req = e.params.request as { url: string; headers: Json };
      intercepted.push({ url: req.url, headers: req.headers });
      if (req.url.startsWith('https://dlwatcher.com/')) {
        void cdp.send(
          'Fetch.fulfillRequest',
          {
            requestId: e.params.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from('{}').toString('base64'),
          },
          pg,
        );
      } else {
        void cdp.send('Fetch.failRequest', { requestId: e.params.requestId, errorReason: 'BlockedByClient' }, pg);
      }
    });

    await cdp.send('Page.navigate', { url: `${EXT}/popup.html` }, pg);
    await poll(async () => ((await evaluate(cdp, pg, `!!document.querySelector('input')`)) ? true : undefined), 15_000, 'popup render');

    // ---- M1 完成標準：在 popup 手動加一個作品，看得到現價 ----
    await evaluate(cdp, pg, `document.querySelector('input').focus(); true`);
    await cdp.send('Input.insertText', { text: TEST_WORK }, pg);
    await evaluate(cdp, pg, `[...document.querySelectorAll('button')].find((b) => b.textContent === '加入追蹤').click(); true`);
    try {
      const priceText = await poll(
        async () => {
          const t = (await evaluate(
            cdp,
            pg,
            `document.querySelector('[data-work-id="${TEST_WORK}"] [data-testid="price"]')?.textContent ?? ''`,
          )) as string;
          return /¥\d/.test(t) ? t : undefined;
        },
        20_000,
        'price shown',
      );
      const title = (await evaluate(cdp, pg, `document.querySelector('[data-work-id="${TEST_WORK}"] a')?.textContent ?? ''`)) as string;
      const href = (await evaluate(
        cdp,
        pg,
        `document.querySelector('[data-work-id="${TEST_WORK}"] a')?.getAttribute('href') ?? ''`,
      )) as string;
      record('popup 手動加入作品後顯示現價（M1）', true, `${title.slice(0, 30)}… ${priceText}`);
      record(
        '作品連結由 buildWorkUrl 組出',
        /^https:\/\/www\.dlsite\.com\/[a-z-]+\/work\/=\/product_id\/RJ01014447\.html$/.test(href),
        href,
      );
    } catch (e) {
      record('popup 手動加入作品後顯示現價（M1）', false, String(e));
    }

    // ---- §10.3 擴充功能來源：popup（分頁）送訊息時的 sender ----
    await evaluate(cdp, pg, `chrome.runtime.sendMessage({ __probe: 'popup-tab' }).catch(() => null).then(() => true)`);
    await sleep(300);
    const senders = (await evaluate(cdp, sw, `__probeSenders`)) as {
      probe: string;
      id: boolean;
      origin: string;
      url: string;
      hasTab: boolean;
    }[];
    const s = senders.find((x) => x.probe === 'popup-tab');
    record(
      '擴充功能頁面送訊息時 sender.origin 是 chrome-extension://<id>（§10.3）',
      s?.origin === EXT && s?.id === true && !!s?.url.startsWith(`${EXT}/`),
      JSON.stringify(s),
    );

    // ---- §4.2 background 記錄的鎖定結果 ----
    const lock = (await evaluate(cdp, pg, `chrome.storage.session.get('storageLock').then((v) => v.storageLock ?? null)`)) as {
      ok?: boolean;
    } | null;
    record('background 記錄 setAccessLevel 成功（storage.session 的 storageLock）', lock?.ok === true, JSON.stringify(lock));

    // ---- CSP img-src 放行 img.dlsite.jp（作品圖片）----
    const imageUrl = (await evaluate(
      cdp,
      pg,
      `chrome.storage.local.get('items').then((v) => (v.items ?? []).find((i) => i.id === '${TEST_WORK}')?.imageUrl ?? '')`,
    )) as string;
    const okImg = imageUrl
      ? await evaluate(
          cdp,
          pg,
          `new Promise((r) => { const i = new Image(); i.onload = () => r('loaded'); i.onerror = () => r('error'); i.src = ${JSON.stringify(imageUrl)}; setTimeout(() => r('timeout'), 10000); })`,
        )
      : 'no imageUrl';
    await sleep(200);
    const imgViolations = ((await evaluate(cdp, pg, `window.__csp`)) as { directive: string }[]).filter((v) => v.directive === 'img-src');
    record(
      'CSP img-src 放行 img.dlsite.jp 的作品圖片',
      imageUrl.startsWith('https://img.dlsite.jp/') && okImg === 'loaded' && imgViolations.length === 0,
      `${imageUrl.slice(0, 60)} → ${String(okImg)}`,
    );

    // ---- §10.3 收緊的 CSP（擴充功能頁面）----
    const cspProbeStart = problems.length;
    const cspFetch = await evaluate(
      cdp,
      pg,
      `fetch('https://www.dlsite.com/home/mypage/coupon').then(() => 'allowed', (e) => 'blocked: ' + e.message)`,
    );
    const cspForm = await evaluate(
      cdp,
      pg,
      `(async () => { const f = document.createElement('form'); f.action = 'https://example.com/form'; f.method = 'get'; document.body.append(f); f.submit(); await new Promise((r) => setTimeout(r, 1000)); return location.href; })()`,
    );
    const cspCss = await evaluate(
      cdp,
      pg,
      `new Promise((r) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://www.dlsite.com/x.css'; l.onload = () => r('loaded'); l.onerror = () => r('error'); document.head.append(l); setTimeout(() => r('timeout'), 3000); })`,
    );
    const cspImg = await evaluate(
      cdp,
      pg,
      `new Promise((r) => { const i = new Image(); i.onload = () => r('loaded'); i.onerror = () => r('error'); i.src = 'https://www.dlsite.com/images/web/home/no_img_main.gif'; setTimeout(() => r('timeout'), 3000); })`,
    );
    await sleep(300);
    expectedWindows.push([cspProbeStart, problems.length]);
    const violations = (await evaluate(cdp, pg, `window.__csp`)) as { directive: string; blocked: string }[];
    const has = (d: string) => violations.some((v) => v.directive === d);
    const sawCoupon = intercepted.some((r) => r.url.includes('mypage/coupon'));
    record(
      'CSP connect-src 擋住 /home/mypage/coupon（請求沒有送出）',
      String(cspFetch).startsWith('blocked') && has('connect-src') && !sawCoupon,
      `${String(cspFetch)}; violation=${has('connect-src')}; reachedNetwork=${sawCoupon}`,
    );
    record(
      'CSP form-action 擋住 <form> 送出',
      has('form-action') &&
        !intercepted.some((r) => r.url.startsWith('https://example.com/form')) &&
        String(cspForm).startsWith(`${EXT}/popup.html`),
      `violation=${has('form-action')}; location=${String(cspForm)}`,
    );
    record(
      'CSP style-src 擋住外部 CSS',
      cspCss === 'error' && has('style-src-elem'),
      `${String(cspCss)}; violation=${has('style-src-elem')}`,
    );
    record(
      'CSP img-src 擋住 img.dlsite.jp 以外的圖片',
      cspImg === 'error' && has('img-src'),
      `${String(cspImg)}; violation=${has('img-src')}`,
    );

    // ---- §10.3 fetch 與 User-Agent ----
    await expectProblems(() =>
      evaluate(
        cdp,
        pg,
        `fetch('https://dlwatcher.com/product/RJ01014447.json', { headers: { 'User-Agent': 'dl-assistant-ua-test' } }).then(() => 'ok', (e) => 'error: ' + e.message)`,
      ),
    );
    const uaReq = intercepted.find((r) => r.url.startsWith('https://dlwatcher.com/'));
    const sentUa = uaReq
      ? String(Object.entries(uaReq.headers).find(([k]) => k.toLowerCase() === 'user-agent')?.[1] ?? '')
      : '(no request)';
    note(
      'fetch 能否覆寫 User-Agent（§10.3）',
      sentUa.includes('dl-assistant-ua-test')
        ? `可以覆寫（送出 "${sentUa}"）`
        : `不能覆寫（送出的仍是瀏覽器的 UA：${sentUa.slice(0, 60)}…）`,
    );

    // ---- §10.3 meta refresh（最後做，可能會離開頁面）----
    const metaStart = problems.length;
    await evaluate(
      cdp,
      pg,
      `(() => { const m = document.createElement('meta'); m.httpEquiv = 'refresh'; m.content = '0;url=https://example.com/meta'; document.head.append(m); return true; })()`,
    );
    await sleep(2500);
    expectedWindows.push([metaStart, problems.length]);
    const afterMeta = (await evaluate(cdp, pg, `location.href`)) as string;
    const metaReq = intercepted.some((r) => r.url.startsWith('https://example.com/meta'));
    note(
      '以程式插入 <meta http-equiv=refresh> 會不會導覽（§10.3）',
      metaReq || !afterMeta.startsWith(EXT) ? `會導覽（嘗試前往 example.com；請求已被攔截）` : `不會導覽（仍在 ${afterMeta}）`,
    );

    // ---- service worker 的 CSP（connect-src 也約束 background）----
    const swFetch = await expectProblems(() =>
      evaluate(cdp, sw, `fetch('https://www.dlsite.com/home/').then(() => 'allowed', (e) => 'blocked: ' + e.message)`),
    );
    record('CSP connect-src 也擋住 service worker 對白名單外路徑的請求', String(swFetch).startsWith('blocked'), String(swFetch));

    // ---- §4.2 setAccessLevel：content script 呼叫 storage.local 會失敗 ----
    const { targetId: dlTarget } = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    const { sessionId: dl } = (await cdp.send('Target.attachToTarget', { targetId: dlTarget, flatten: true })) as { sessionId: string };
    // DLsite 頁面整個由 CDP 回應假的 HTML，不會連到 DLsite。
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://www.dlsite.com/*' }] }, dl);
    cdp.on((e) => {
      if (e.method !== 'Fetch.requestPaused' || e.sessionId !== dl) return;
      void cdp.send(
        'Fetch.fulfillRequest',
        {
          requestId: e.params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: Buffer.from('<!doctype html><title>test</title><p>fake DLsite page</p>').toString('base64'),
        },
        dl,
      );
    });
    const contexts: { id: number; name: string; origin: string; auxData?: { type?: string } }[] = [];
    cdp.on((e) => {
      if (e.method === 'Runtime.executionContextCreated' && e.sessionId === dl)
        contexts.push(e.params.context as (typeof contexts)[number]);
    });
    await cdp.send('Runtime.enable', {}, dl);
    await cdp.send('Page.enable', {}, dl);
    await cdp.send('Page.navigate', { url: 'https://www.dlsite.com/home/__dl_assistant_verify__' }, dl);
    try {
      const ctx = await poll(
        async () => contexts.find((c) => c.auxData?.type === 'isolated' && c.name === 'DL_Assistant'),
        15_000,
        'content script context',
      );
      const inCs = await evaluate(cdp, dl, `({ runtimeId: chrome.runtime.id, hasStorage: typeof chrome.storage })`, ctx.id);
      const local = await evaluate(
        cdp,
        dl,
        `chrome.storage.local.get(null).then((v) => 'allowed: ' + Object.keys(v).join(','), (e) => 'blocked: ' + e.message)`,
        ctx.id,
      );
      const session = await evaluate(
        cdp,
        dl,
        `chrome.storage.session.get(null).then(() => 'allowed', (e) => 'blocked: ' + e.message)`,
        ctx.id,
      );
      record(
        'setAccessLevel 生效：content script 呼叫 chrome.storage.local.get 失敗（§4.2）',
        String(local).startsWith('blocked'),
        `${JSON.stringify(inCs)}; local=${String(local)}`,
      );
      record('storage.session 對 content script 維持不可讀', String(session).startsWith('blocked'), String(session));
    } catch (e) {
      record('setAccessLevel 生效：content script 呼叫 chrome.storage.local.get 失敗（§4.2）', false, String(e));
    }

    // ---- zod jitless：整個流程沒有 CSP 違規或例外（§7.2）----
    // 只排除上面刻意觸發違規的區段（以發生的先後判斷，不比對訊息內容）
    const relevant = problems.filter((_, i) => !expectedWindows.some(([a, b]) => i >= a && i < b));
    record(
      '解析過程沒有 eval／CSP 違規或未處理的例外（zod jitless，§7.2）',
      relevant.length === 0,
      relevant.slice(0, 5).join(' | ') || 'none',
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
