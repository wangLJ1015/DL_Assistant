// §3.2.4 訊息白名單與來源檢查。訊息清單是完整的：新增訊息要改規格與快照測試。
import { z } from 'zod';
import { isWorkId } from './ids';
import { intIn } from './schema';
import { rulesSchema } from './models';

const workId = z.string().refine(isWorkId, { message: 'invalid work id' });

// ---- content script → background ----

export const couponSyncResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ok'),
      // 每張券的完整驗證在 background 重做（M7，§5.4）；這裡只限制形狀與數量。
      coupons: z.array(z.unknown()).max(500),
      total: z.number().int().min(0).max(10_000),
      invalid: z
        .array(z.object({ index: z.number().int().min(0), path: z.string().max(200), code: z.string().max(50) }).strict())
        .max(10_000),
    })
    .strict(),
  z.object({ status: z.literal('notLoggedIn') }).strict(),
  z.object({ status: z.literal('failed'), httpStatus: z.number().int().min(0).max(999).optional() }).strict(),
  z.object({ status: z.literal('unparsable') }).strict(),
]);

export const contentMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cartClicked'), id: workId }).strict(),
  z.object({ type: z.literal('cartSnapshot'), ids: z.array(workId).max(200) }).strict(),
  z.object({ type: z.literal('track'), id: workId }).strict(),
  z.object({ type: z.literal('badgeInfo'), id: workId }).strict(),
  z.object({ type: z.literal('lookup'), id: workId }).strict(),
  z.object({ type: z.literal('openPage'), page: z.enum(['dashboard', 'lookup']), id: workId.optional() }).strict(),
  z.object({ type: z.literal('shouldSyncCoupons') }).strict(),
  z.object({ type: z.literal('couponSyncResult'), token: z.uuid(), result: couponSyncResultSchema }).strict(),
]);
export type ContentMessage = z.infer<typeof contentMessageSchema>;

// ---- 擴充功能頁面 → background ----

/** setSettings 只接受使用者可以編輯的欄位（§3.2.4）。 */
export const settingsPartialSchema = z
  .object({
    checkIntervalHours: z.number().int().min(1).max(24),
    dlwatcherEnabled: z.boolean(),
    usePointPaymentMethod: z.boolean(),
    treatUnknownDiscountedAsUsable: z.boolean(),
    hideTitlesInNotifications: z.boolean(),
    showBadge: z.boolean(),
    rules: rulesSchema,
  })
  .partial()
  .strict();

export const extMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('track'), id: workId, from: z.enum(['manual', 'lookup']) }).strict(),
  z.object({ type: z.literal('untrack'), id: workId }).strict(),
  z.object({ type: z.literal('setPaused'), id: workId, paused: z.boolean() }).strict(),
  z.object({ type: z.literal('setTarget'), id: workId, price: intIn(0, 1_000_000).optional() }).strict(),
  z.object({ type: z.literal('lookup'), id: workId }).strict(),
  z.object({ type: z.literal('recheck'), ids: z.array(workId).min(1).max(100) }).strict(),
  z.object({ type: z.literal('syncCouponsNow') }).strict(),
  z.object({ type: z.literal('clearCoupons') }).strict(),
  z.object({ type: z.literal('setCouponReserved'), key: z.string().min(1).max(300), reserved: z.boolean() }).strict(),
  z.object({ type: z.literal('setSettings'), partial: settingsPartialSchema }).strict(),
  z.object({ type: z.literal('resumeDlwatcher') }).strict(),
]);
export type ExtMessage = z.infer<typeof extMessageSchema>;

// ---- background → content script ----

export const toContentMessageSchema = z.discriminatedUnion('type', [z.object({ type: z.literal('syncNow') }).strict()]);
export type ToContentMessage = z.infer<typeof toContentMessageSchema>;

// ---- 回覆 ----

export type WriteReply = { ok: true } | { ok: false; reason: string };

// ---- 來源檢查 ----

/** chrome.runtime.MessageSender 會用到的欄位。 */
export interface SenderLike {
  id?: string;
  origin?: string;
  url?: string;
  frameId?: number;
  tab?: unknown;
  documentId?: string;
  documentLifecycle?: string;
}

export const DLSITE_ORIGIN = 'https://www.dlsite.com';

/**
 * content script 的訊息：同一個擴充功能、來自 www.dlsite.com 的主框架分頁、文件仍在作用中。
 */
export function isContentSender(sender: SenderLike, runtimeId: string): boolean {
  return (
    sender.id === runtimeId &&
    sender.origin === DLSITE_ORIGIN &&
    sender.frameId === 0 &&
    sender.tab !== undefined &&
    sender.tab !== null &&
    (sender.documentLifecycle === undefined || sender.documentLifecycle === 'active')
  );
}

/**
 * 擴充功能頁面的訊息。來源不用 new URL(...).origin 判斷（非特殊 scheme 會得到 "null"），
 * 也不看有沒有 sender.tab（儀表板開在分頁裡也會帶 tab）。
 * `extBaseUrl` 是 chrome.runtime.getURL('')，例如 `chrome-extension://<id>/`。
 */
export function isExtPageSender(sender: SenderLike, runtimeId: string, extBaseUrl: string): boolean {
  const extOrigin = `chrome-extension://${runtimeId}`;
  return (
    sender.id === runtimeId &&
    sender.origin === extOrigin &&
    typeof sender.url === 'string' &&
    extBaseUrl === `${extOrigin}/` &&
    sender.url.startsWith(extBaseUrl)
  );
}

/** content script 端：只接受來自 background（同一個擴充功能、沒有 tab）的訊息。 */
export function isBackgroundSender(sender: SenderLike, runtimeId: string): boolean {
  return sender.id === runtimeId && sender.tab === undefined;
}

export type Classified = { from: 'content'; msg: ContentMessage } | { from: 'ext'; msg: ExtMessage } | { from: 'rejected' };

/** 依來源選擇該組的 schema 驗證；來源不符或格式不符一律拒絕。 */
export function classifyMessage(raw: unknown, sender: SenderLike, runtimeId: string, extBaseUrl: string): Classified {
  if (isExtPageSender(sender, runtimeId, extBaseUrl)) {
    const r = extMessageSchema.safeParse(raw);
    return r.success ? { from: 'ext', msg: r.data } : { from: 'rejected' };
  }
  if (isContentSender(sender, runtimeId)) {
    const r = contentMessageSchema.safeParse(raw);
    return r.success ? { from: 'content', msg: r.data } : { from: 'rejected' };
  }
  return { from: 'rejected' };
}
