import '../lib/zod-setup';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { workIdFromUrl } from '../lib/ids';
import { isCartPageUrl } from '../lib/selectors';
import { CART_ITEM_SELECTOR, CART_LIST_SELECTOR, cartIdFromEvent, readCartIds } from '../content/cart';
import { createRuntimeSender } from '../content/messaging';

// content script（manifest 的 content_scripts 在 wxt.config.ts 註冊）。
//
// 刻意不用 WXT 的 defineContentScript：它的 ContentScriptContext 會對頁面 document 派送 CustomEvent、
// 呼叫 window.postMessage(..., '*')（事件名稱含擴充功能 ID），並監聽頁面上的同名事件——
// 頁面腳本因此能得知擴充功能 ID，也能派送假事件讓 content script 自我停用（違反 §3.2.4）。
// unlisted script 的包裝層只呼叫 main()。
//
// M2：加入購物車偵測（F1）、購物車同步（F2）。徽章在 M6；優惠券同步在 M7。

/** 購物車頁的清單最多等多久才出現（頁面用 JS 渲染時）。 */
const CART_LIST_WAIT_MS = 10_000;

export default defineUnlistedScript(() => {
  // run_at: document_start——頁面還沒有任何元素時就取出 chrome.runtime.sendMessage。
  // 之後頁面放 <form id="chrome"> 或 <form id="browser"> 會蓋掉這兩個全域（DOM clobbering，M2 審查後實測），
  // 但已經取出的參照不受影響（messaging.ts）。
  const sendToBackground = createRuntimeSender();
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
  if (isCartPageUrl(pageUrl)) void domReady().then(whenVisible).then(waitForCartList).then(sendCart);

  function sendCart(found: boolean) {
    // 清單元素一直沒出現（還沒渲染完或選擇器失效）就不送：不覆蓋 lastCart，也不用掉這份文件唯一的一次。
    if (!found) return;
    void sendToBackground({ type: 'cartSnapshot', ids: readCartIds(document.querySelectorAll(CART_ITEM_SELECTOR)) });
  }
});

/** document_start 時 DOM 還沒解析完；等 DOMContentLoaded。 */
function domReady(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
}

/** 預渲染中的頁面送的訊息會被 background 拒絕（documentLifecycle 不是 active），等使用者真的打開再送。 */
function whenVisible(): Promise<void> {
  const doc = document as Document & { prerendering?: boolean };
  if (doc.prerendering !== true) return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('prerenderingchange', () => resolve(), { once: true }));
}

/** 等購物車清單元素出現（空的購物車也有 ul.cart_list）；逾時回傳 false。 */
function waitForCartList(): Promise<boolean> {
  if (document.querySelector(CART_LIST_SELECTOR)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector(CART_LIST_SELECTOR)) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve(true);
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, CART_LIST_WAIT_MS);
    observer.observe(document, { childList: true, subtree: true });
  });
}
