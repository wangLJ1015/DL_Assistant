// §7.1 manifest 的固定值。wxt.config.ts 用它產生 manifest，scripts/check-manifest.ts 用它比對輸出。
// 改這裡就是改規格：要同時更新 docs/security.md §7.1。

export const MANIFEST_PERMISSIONS = ['storage', 'alarms', 'notifications', 'unlimitedStorage', 'contextMenus'] as const;

export const MANIFEST_HOST_PERMISSIONS = ['https://www.dlsite.com/*', 'https://dlwatcher.com/*'] as const;

export const MANIFEST_CSP =
  "default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' https://img.dlsite.jp data:; " +
  "connect-src 'self' https://www.dlsite.com/maniax/product/info/ajax https://dlwatcher.com/product/; " +
  "style-src 'self'; font-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'";

/**
 * 只給 `wxt`（開發伺服器）用的 CSP。2026-11-23 實測（§10.3）：§7.1 的 CSP 在開發模式會擋住
 * HMR 的 WebSocket（connect-src）與 Vite 注入的 <style>（style-src），所以只在開發模式放寬這兩項。
 * check-manifest 確認正式建置沒有 'unsafe-inline' 與 localhost。
 */
export const DEV_MANIFEST_CSP = MANIFEST_CSP.replace(
  "connect-src 'self'",
  "connect-src 'self' http://localhost:3000 ws://localhost:3000",
).replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");

export const MINIMUM_CHROME_VERSION = '120';

export const CONTENT_SCRIPT_MATCHES = ['https://www.dlsite.com/*'] as const;
/** src/entrypoints/dlsite-content.ts 的打包結果。 */
export const CONTENT_SCRIPT_FILE = 'dlsite-content.js';
