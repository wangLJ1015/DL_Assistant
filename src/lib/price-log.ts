// §5.3 自己的查價紀錄（priceLog）的規則。純函式，IndexedDB 的讀寫在 db.ts。
import { isoToMs } from './dates';
import type { PriceLogEntry, PriceSnapshot } from './models';

/** 一次查價的結果（查不到時價格欄位沿用上一次的快照，status 為 'unavailable'）。 */
export interface PriceObservation {
  id: string;
  price: number;
  officialPrice: number;
  isDiscount: boolean;
  discountRate: number;
  campaignId?: string;
  status?: 'unavailable';
  at: string;
}

export function observationFromSnapshot(s: PriceSnapshot): PriceObservation {
  const o: PriceObservation = {
    id: s.id,
    price: s.price,
    officialPrice: s.officialPrice,
    isDiscount: s.isDiscount,
    discountRate: s.discountRate,
    at: s.checkedAt,
  };
  if (s.campaignId !== undefined) o.campaignId = s.campaignId;
  if (!s.available) o.status = 'unavailable';
  return o;
}

/** §5.3：兩次查價之間超過這個時間，就算內容相同也新增一筆（代表中間有一段沒查價）。 */
export function priceLogGapMs(checkIntervalHours: number): number {
  return 2 * checkIntervalHours * 3_600_000;
}

function sameContent(e: PriceLogEntry, o: PriceObservation): boolean {
  return (
    (e.status ?? null) === (o.status ?? null) &&
    e.price === o.price &&
    e.officialPrice === o.officialPrice &&
    e.isDiscount === o.isDiscount &&
    e.discountRate === o.discountRate &&
    (e.campaignId ?? null) === (o.campaignId ?? null)
  );
}

/**
 * §5.3：以下任一情況新增一筆，否則只更新最後一筆的 lastSeenAt：
 * 1. status、price、officialPrice、isDiscount、discountRate、campaignId 任一和最後一筆不同
 * 2. 這次查價時間 − 最後一筆的 lastSeenAt > gapMs（2 × 查價週期）
 * 查價時間不晚於最後一筆的 lastSeenAt（時鐘倒退、重複處理）時不寫（回傳 null）。
 */
export function nextPriceLogEntry(
  last: PriceLogEntry | undefined,
  o: PriceObservation,
  gapMs: number,
): { entry: PriceLogEntry; isNew: boolean } | null {
  if (last) {
    const t = isoToMs(o.at);
    if (t <= isoToMs(last.lastSeenAt)) return null;
    if (sameContent(last, o) && t - isoToMs(last.lastSeenAt) <= gapMs) {
      return { entry: { ...last, lastSeenAt: o.at }, isNew: false };
    }
  }
  const entry: PriceLogEntry = {
    id: o.id,
    price: o.price,
    officialPrice: o.officialPrice,
    isDiscount: o.isDiscount,
    discountRate: o.discountRate,
    at: o.at,
    lastSeenAt: o.at,
  };
  if (o.campaignId !== undefined) entry.campaignId = o.campaignId;
  if (o.status) entry.status = o.status;
  return { entry, isNew: true };
}
