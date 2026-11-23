// content script → background 的訊息（§3.2.4）。
import { browser } from 'wxt/browser';
import type { ContentMessage } from '../lib/messages';

/**
 * 送訊息給 background。失敗（service worker 冷啟動中、`lastError`）時最多重試一次；
 * 擴充功能更新後舊分頁失去連線（「Extension context invalidated」）時不重試、不報錯。
 */
export async function sendToBackground(msg: ContentMessage): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await browser.runtime.sendMessage(msg);
    } catch (e) {
      if (attempt > 0 || /context invalidated/i.test(String(e))) return undefined;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return undefined;
}
