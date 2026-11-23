// content script → background 訊息的處理（§3.2.4）。來源檢查與 schema 驗證已在 classifyMessage 做完。
import { autoTrack, CART_SNAPSHOT_MAX_NEW, claimDocument, type AutoTrackResult } from './auto-track';
import type { ContentMessage, SenderLike, WriteReply } from './messages';
import { isCartPageUrl } from './selectors';

/** 一件都沒加入而且被上限擋下時回覆 rateLimited／limit（§3.2.4），其他一律 ok。 */
const reply = (r: AutoTrackResult): WriteReply => (r.blockedBy ? { ok: false, reason: r.blockedBy } : { ok: true });

export async function handleContentMessage(msg: ContentMessage, sender: SenderLike): Promise<WriteReply> {
  switch (msg.type) {
    case 'cartClicked':
      // F1：點擊就當作「想買」，不等加入成功（§2）。使用者自己移除過的作品也照樣加回來（剛按了按鈕）。
      return reply(await autoTrack([msg.id], 'cart'));
    case 'cartSnapshot': {
      // F2：只接受購物車頁送來的，同一個文件只接受一次。使用者自己移除過的作品不加回來（untracked）。
      if (sender.url === undefined || !isCartPageUrl(sender.url)) return { ok: false, reason: 'notCartPage' };
      if (!(await claimDocument('cart', sender.documentId))) return { ok: false, reason: 'duplicate' };
      return reply(await autoTrack(msg.ids, 'cart', { maxNew: CART_SNAPSHOT_MAX_NEW, lastCartIds: msg.ids, skipUntracked: true }));
    }
    case 'track':
      // 作品頁的「加入追蹤」（M6 的按鈕）：一律記成 source: 'page'，同一個文件一次，計入每日上限。
      if (!(await claimDocument('track', sender.documentId))) return { ok: false, reason: 'duplicate' };
      return reply(await autoTrack([msg.id], 'page'));
    default:
      // badgeInfo、lookup、openPage 在 M6；shouldSyncCoupons、couponSyncResult 在 M7。
      return { ok: false, reason: 'notImplemented' };
  }
}
