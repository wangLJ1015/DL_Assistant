// §10.3「開發模式 CSP」：WXT 開發模式下，§7.1 的 CSP 會不會擋住 HMR 的樣式與連線。
//
//   pnpm dev            （另一個終端機，保持執行）
//   node tests/e2e/check-dev-csp.ts
//
// 用臨時 profile 載入 .output/chrome-mv3-dev，打開 popup，列出 CSP 違規與樣式是否套用。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { Cdp, evaluate, poll, sleep } from './cdp.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const profile = mkdtempSync(join(tmpdir(), 'dl-assistant-devcsp-'));
const child = spawn(
  CHROME,
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
const cdp = new Cdp(child.stdio[3] as Writable, child.stdio[4] as Readable);

try {
  const { id } = (await cdp.send('Extensions.loadUnpacked', { path: join(ROOT, '.output/chrome-mv3-dev') })) as { id: string };
  const logs: string[] = [];
  const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
  const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
  cdp.on((e) => {
    if (e.sessionId === sessionId && e.method === 'Log.entryAdded') logs.push(String((e.params.entry as { text: string }).text));
  });
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));`,
    },
    sessionId,
  );
  await cdp.send('Page.navigate', { url: `chrome-extension://${id}/popup.html` }, sessionId);
  await poll(
    async () => ((await evaluate(cdp, sessionId, `!!document.querySelector('button')`)) ? true : undefined),
    20_000,
    'popup render',
  );
  await sleep(2000);
  const bg = await evaluate(cdp, sessionId, `getComputedStyle(document.querySelector('button')).backgroundColor`);
  const violations = await evaluate(cdp, sessionId, `window.__csp`);
  console.log(JSON.stringify({ buttonBackground: bg, violations, logs: logs.slice(0, 10) }, null, 2));
} finally {
  try {
    await cdp.send('Browser.close');
  } catch {
    child.kill();
  }
  await new Promise((r) => child.once('exit', r));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
