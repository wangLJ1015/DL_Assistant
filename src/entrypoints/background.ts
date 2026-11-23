import '../lib/zod-setup';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { classifyMessage, type ContentMessage, type ExtMessage, type SenderLike, type WriteReply } from '../lib/messages';
import { lockStorageToTrustedContexts } from '../lib/storage';
import { refreshPrices, trackItem, untrackItem, updateSettings } from '../lib/tracking';

type Reply = WriteReply | Record<string, unknown>;

async function handleExt(msg: ExtMessage): Promise<Reply> {
  switch (msg.type) {
    case 'track':
      return trackItem(msg.id, msg.from);
    case 'untrack':
      return untrackItem(msg.id);
    case 'recheck': {
      // M1：直接查價。M3 改成放進 productInfo 佇列並套用 10 分鐘冷卻（§3.2.4）。
      const r = await refreshPrices(msg.ids);
      return r.ok ? { ok: true } : r;
    }
    case 'setSettings':
      return updateSettings(msg.partial);
    default:
      return { ok: false, reason: 'notImplemented' };
  }
}

async function handleContent(_msg: ContentMessage): Promise<Reply> {
  // content script 的訊息在 M2 起實作。
  return { ok: false, reason: 'notImplemented' };
}

export default defineBackground(() => {
  // §4.2：每次 service worker 啟動都鎖住 storage.local，content script 不能直接讀寫。
  void lockStorageToTrustedContexts().catch(() => undefined);

  // §4.1：所有監聽器在最上層同步註冊。
  browser.runtime.onInstalled.addListener(() => {
    void lockStorageToTrustedContexts().catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((raw: unknown, sender: SenderLike, sendResponse: (r: unknown) => void) => {
    const c = classifyMessage(raw, sender, browser.runtime.id, browser.runtime.getURL('/'));
    if (c.from === 'rejected') return false;
    const job = c.from === 'ext' ? handleExt(c.msg) : handleContent(c.msg);
    job.then(sendResponse, () => sendResponse({ ok: false, reason: 'failed' }));
    // §3.2.4：非同步回覆一律 return true ＋ sendResponse()。
    return true;
  });
});
