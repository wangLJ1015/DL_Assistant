import '../lib/zod-setup';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { handleContentMessage } from '../lib/content-handlers';
import { classifyMessage, type ExtMessage, type SenderLike, type WriteReply } from '../lib/messages';
import { ensureSchedule, handleAlarm } from '../lib/queue';
import { lockStorageToTrustedContexts } from '../lib/storage';
import { recheck, resumeDlwatcher, trackItem, untrackItem, updateSettings } from '../lib/tracking';

type Reply = WriteReply | Record<string, unknown>;

async function handleExt(msg: ExtMessage): Promise<Reply> {
  switch (msg.type) {
    case 'track':
      // 擴充功能頁面等第一次查價做完才回覆，popup 才知道要顯示價格、「查不到」還是「重新查價」。
      return trackItem(msg.id, msg.from, { awaitPrice: true });
    case 'untrack':
      return untrackItem(msg.id);
    case 'recheck':
      // §3.2.4：放進 productInfo 佇列（照樣套用間隔與退避），同一件作品 10 分鐘內只重新查價一次。
      return recheck(msg.ids);
    case 'setSettings':
      return updateSettings(msg.partial);
    case 'resumeDlwatcher':
      return resumeDlwatcher();
    default:
      return { ok: false, reason: 'notImplemented' };
  }
}

const logError = (what: string) => (e: unknown) => console.error(`[DL_Assistant] ${what}`, e);

export default defineBackground(() => {
  // §4.2：每次 service worker 啟動都鎖住 storage.local，content script 不能直接讀寫。
  // 失敗時 lockStorageToTrustedContexts 會記錄並輸出錯誤，不會丟例外。
  void lockStorageToTrustedContexts();
  // §4.1：每次啟動都確認排程還在；上次查價途中被終止的話接著做。
  void ensureSchedule().catch(logError('排程檢查失敗'));

  // §4.1：所有監聽器在最上層同步註冊。
  // onStartup：瀏覽器啟動時喚醒 service worker，讓鎖定不必等到第一則訊息才生效。
  browser.runtime.onInstalled.addListener(() => {
    void lockStorageToTrustedContexts();
    void ensureSchedule().catch(logError('排程檢查失敗'));
  });
  browser.runtime.onStartup.addListener(() => {
    void lockStorageToTrustedContexts();
    void ensureSchedule().catch(logError('排程檢查失敗'));
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    void handleAlarm(alarm.name).catch(logError('alarm 處理失敗'));
  });

  browser.runtime.onMessage.addListener((raw: unknown, sender: SenderLike, sendResponse: (r: unknown) => void) => {
    const c = classifyMessage(raw, sender, browser.runtime.id, browser.runtime.getURL('/'));
    if (c.from === 'rejected') return false;
    const job = c.from === 'ext' ? handleExt(c.msg) : handleContentMessage(c.msg, sender);
    job.then(sendResponse, (e: unknown) => {
      console.error('[DL_Assistant] 訊息處理失敗', e);
      sendResponse({ ok: false, reason: 'failed' });
    });
    // §3.2.4：非同步回覆一律 return true ＋ sendResponse()。
    return true;
  });
});
