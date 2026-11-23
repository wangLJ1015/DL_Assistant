import '../lib/zod-setup';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { workIdFromUrl } from '../lib/ids';
import { isCartPageUrl } from '../lib/selectors';
import { CART_ITEM_SELECTOR, cartIdFromEvent, readCartIds } from '../content/cart';
import { sendToBackground } from '../content/messaging';

// content script（manifest 的 content_scripts 在 wxt.config.ts 註冊）。
//
// 刻意不用 WXT 的 defineContentScript：它的 ContentScriptContext 會對頁面 document 派送 CustomEvent、
// 呼叫 window.postMessage(..., '*')（事件名稱含擴充功能 ID），並監聽頁面上的同名事件——
// 頁面腳本因此能得知擴充功能 ID，也能派送假事件讓 content script 自我停用（違反 §3.2.4）。
// unlisted script 的包裝層只呼叫 main()。
//
// M2：加入購物車偵測（F1）、購物車同步（F2）。徽章在 M6；優惠券同步在 M7。
export default defineUnlistedScript(() => {
  // 頁面網址在文件載入時決定一次，之後不跟著 history.pushState 改變（§3.2.5）。
  const pageUrl = document.URL;
  const pageWorkId = workIdFromUrl(pageUrl);

  // F1：capture 階段的事件委派，動態載入的按鈕也偵測得到。只處理使用者真的點擊（isTrusted）。
  const onClick = (e: MouseEvent) => {
    const id = cartIdFromEvent(e, pageWorkId, pageUrl);
    if (id) void sendToBackground({ type: 'cartClicked', id });
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onClick, true);

  // F2：打開購物車頁時把頁面上的作品補進追蹤清單（不發 fetch 讀購物車）。
  if (isCartPageUrl(pageUrl)) {
    void sendToBackground({ type: 'cartSnapshot', ids: readCartIds(document.querySelectorAll(CART_ITEM_SELECTOR)) });
  }
});
