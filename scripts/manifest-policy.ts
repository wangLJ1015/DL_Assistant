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
/**
 * §3.2.5：結帳、付款、帳號相關頁面不注入 content script（2026-11-23 實測的路徑，§10.3）。
 * 立即購買：/<分站>/pay/…；マイページ（含帳號設定、優惠券）：/<分站>/mypage/…；登入：/<分站>/login/…；註冊：/<分站>/regist/…。
 * 路徑結尾不要求斜線（寫成 「…/mypage」 後面直接接萬用字元）：要求斜線的寫法擋不到 /home/mypage 這種網址（M2 審查重現）。
 * 代價是 /home/guide/payment 之類名稱相近的頁面也會被排除（只是少了 content script，沒有安全影響）。
 * 購物車頁（/<分站>/cart/）要讀作品清單（F2），不排除。
 */
export const CONTENT_SCRIPT_EXCLUDE_MATCHES = [
  'https://www.dlsite.com/*/pay*',
  'https://www.dlsite.com/*/mypage*',
  'https://www.dlsite.com/*/login*',
  'https://www.dlsite.com/*/regist*',
] as const;
/** 頁面還沒有任何元素時執行，先取出 chrome.runtime（DOM clobbering，§3.2.5）。 */
export const CONTENT_SCRIPT_RUN_AT = 'document_start';
/** src/entrypoints/dlsite-content.ts 的打包結果。 */
export const CONTENT_SCRIPT_FILE = 'dlsite-content.js';
