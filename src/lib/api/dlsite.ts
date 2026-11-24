// §5.1 DLsite 商品資訊 API 的 schema 與轉換。
import { z } from 'zod';
import { isWorkId, normalizeImageUrl } from '../ids';
import { intIn, optionalText, summarizeIssues, truncateChars } from '../schema';
import { resolveDiscountEnd } from '../dates';
import type { PriceSnapshot, TrackedItem } from '../models';

/** 一件作品的欄位（未列出的欄位由 zod 去掉）。2026-11-23 實測：沒有打折時 discount_rate、campaign_id、discount_end_date 不出現。 */
export const productEntrySchema = z.object({
  work_name: z.string().max(2000),
  work_image: z.string().max(2000),
  price: intIn(0, 1_000_000),
  official_price: intIn(0, 1_000_000),
  discount_rate: intIn(0, 100).nullish(),
  is_discount: z.boolean(),
  discount_end_date: optionalText(40),
  campaign_id: optionalText(100),
  default_point_rate: intIn(0, 100),
  is_sold_out: z.boolean(),
  site_id: z.string().regex(/^[a-z][a-z-]{0,29}$/),
  work_type: z.string().regex(/^[A-Z0-9]{1,20}$/),
  custom_genres: z.array(z.string().max(100)).max(200),
  is_noreduction: z.boolean(),
});
export type ProductEntry = z.output<typeof productEntrySchema>;

export interface ProductInfo {
  id: string;
  title: string;
  imageUrl: string;
  siteId: string;
  entry: ProductEntry;
}

export type ParseProductResult =
  | {
      ok: true;
      found: Map<string, ProductInfo>;
      /** 請求了但回應裡沒有的編號（不存在或已刪除；2026-11-23 實測是直接不出現）。 */
      missing: string[];
      invalid: { id: string; path: string; code: string }[];
    }
  | { ok: false; reason: 'unparsable' | 'notObject' };

/**
 * 解析商品 API 的回應文字（§3.2.3）。
 * - 最外層是以編號為 key 的物件；全部編號都不存在時是 `[]`（實測）。
 * - 用 Object.entries 逐筆處理；key 必須通過 isWorkId() 而且是這次請求的編號，不符的整筆丟棄。
 * - 每筆各自 safeParse，失敗只影響那一筆。
 */
export function parseProductInfoResponse(text: string, requestedIds: readonly string[]): ParseProductResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'unparsable' };
  }
  const requested = new Set(requestedIds);
  const found = new Map<string, ProductInfo>();
  const invalid: { id: string; path: string; code: string }[] = [];

  if (Array.isArray(raw)) {
    if (raw.length !== 0) return { ok: false, reason: 'notObject' };
  } else if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'notObject' };
  } else {
    for (const [key, value] of Object.entries(raw)) {
      if (!isWorkId(key) || !requested.has(key) || found.has(key)) continue;
      const r = productEntrySchema.safeParse(value);
      if (!r.success) {
        for (const issue of summarizeIssues(r.error)) invalid.push({ id: key, ...issue });
        continue;
      }
      found.set(key, {
        id: key,
        title: truncateChars(r.data.work_name, 300),
        imageUrl: normalizeImageUrl(r.data.work_image),
        siteId: r.data.site_id,
        entry: r.data,
      });
    }
  }
  const invalidIds = new Set(invalid.map((i) => i.id));
  const missing = requestedIds.filter((id) => !found.has(id) && !invalidIds.has(id));
  return { ok: true, found, missing, invalid };
}

/**
 * API 資料 → 本次快照（§6.1 第 1 步）。`episode` 先沿用上次的值，由 rules.ts 的 evaluateWork()（§6.1 第 3 步）重新決定。
 */
export function toSnapshot(info: ProductInfo, prev: PriceSnapshot | undefined, checkedAt: string): PriceSnapshot | undefined {
  // is_sold_out 視同查不到（§5.3）：沿用上一次的價格；沒有上一次的資料時不寫快照。
  if (info.entry.is_sold_out) return unavailableSnapshot(prev, checkedAt);
  return availableFrom(info, checkedAt, prev);
}

function availableFrom(info: ProductInfo, checkedAt: string, prev?: PriceSnapshot): PriceSnapshot {
  const e = info.entry;
  const snap: PriceSnapshot = {
    id: info.id,
    available: true,
    price: e.price,
    officialPrice: e.official_price,
    isDiscount: e.is_discount,
    discountRate: e.discount_rate ?? 0,
    pointRate: e.default_point_rate,
    couponFacts: {
      siteId: e.site_id,
      workType: e.work_type,
      customGenres: [...e.custom_genres],
      noReduction: e.is_noreduction,
    },
    checkedAt,
  };
  if (e.campaign_id !== undefined) snap.campaignId = e.campaign_id;
  if (e.discount_end_date !== undefined) {
    const end = resolveDiscountEnd(e.discount_end_date, checkedAt);
    if (end.kind === 'known') snap.discountEnd = end.iso;
    else if (end.stale) snap.discountEndStale = true;
  }
  if (prev?.episode) snap.episode = { ...prev.episode };
  return snap;
}

/** 查不到：沿用上一次的價格欄位，available = false。沒有上一次的資料時回傳 undefined（§5.3：不寫快照）。 */
export function unavailableSnapshot(prev: PriceSnapshot | undefined, checkedAt: string): PriceSnapshot | undefined {
  if (!prev) return undefined;
  return { ...prev, couponFacts: { ...prev.couponFacts, customGenres: [...prev.couponFacts.customGenres] }, available: false, checkedAt };
}

/** 第一次查價後用 API 的資料更新追蹤清單的名稱、圖片與分站。 */
export function applyProductInfo(item: TrackedItem, info: ProductInfo): TrackedItem {
  return { ...item, title: info.title, imageUrl: info.imageUrl, site: info.siteId };
}
