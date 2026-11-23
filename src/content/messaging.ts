// content script → background 的訊息（§3.2.4）。
import type { ContentMessage } from '../lib/messages';

// 不用 wxt/browser：它在執行時才判斷 `globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome`。
// Chrome 的 isolated world 沒有 `browser` 全域，頁面放一個 <form id="browser"><input name="runtime" id="x">
// 就能讓 globalThis.browser 變成那個表單（DOM clobbering），content script 的訊息全部失效（M2 審查重現）。
// `chrome` 是 isolated world 的 window 自己的屬性，具名元素蓋不掉；而且在載入時就先取出 sendMessage。
declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };

type Send = (message: unknown) => Promise<unknown>;

/** 載入時取出一次，之後頁面改什麼都不影響。測試可以傳入假的 sendMessage。 */
export function createSender(send: Send, retryDelayMs = 500) {
  /**
   * 送訊息給 background。失敗（service worker 冷啟動中、`lastError`）時最多重試一次；
   * 擴充功能更新後舊分頁失去連線（「Extension context invalidated」）時不重試、不報錯。
   */
  return async function sendToBackground(msg: ContentMessage): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await send(msg);
      } catch (e) {
        if (attempt > 0 || /context invalidated/i.test(String(e))) return undefined;
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
    return undefined;
  };
}

/** content script 實際使用的 sender（只在 content script 環境呼叫）。 */
export function createRuntimeSender() {
  const runtime = chrome.runtime;
  return createSender(runtime.sendMessage.bind(runtime));
}
