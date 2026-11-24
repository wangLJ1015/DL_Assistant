// §5.2 DLWatcher 的 zod schema、轉換與合理性檢查（§3.6）。只在 background 使用。
// 2026-11-23 實測的回應：
// - 日期是 toISOString() 格式的 UTC 字串（parseDlwatcherDate）。
// - priceLogGraph.graphs.{年}.points[] 的 x、y 是字串（"0.1221"、"0.8000"）。
// - 進行中的特價，start／end 的 end 是「最後一次看到這個價格的時間」，不是未來的結束時間
//   （查詢當天 15:05 UTC 取得的 end 是當天 10:32 UTC，DLsite 的截止日是 3 天後）。
// - 不存在的作品回 404（text/html）。
// - 不使用回應裡的任何網址（圖片、連結，§5.2）。
import { z } from 'zod';
import { curvePointDate, isoToMs, parseDlwatcherDate } from '../dates';
import { MAX_CURVE_POINTS, MAX_SALES, type HistoryRecord, type PriceLogEntry } from '../models';
import { intIn, summarizeIssues } from '../schema';

/** 0～1 的比例：數字，或最多 20 字的十進位字串（實測是字串）。範圍由合理性檢查負責。 */
const RATIO_RE = /^-?\d{1,6}(?:\.\d{1,12})?$/;
const ratio = z.union([z.number(), z.string().max(20).regex(RATIO_RE).transform(Number)]).pipe(z.number().finite());

const priceInfoSchema = z.object({
  price: intIn(0, 1_000_000),
  regularPrice: intIn(0, 1_000_000),
  discountRate: z.number().finite().min(0).max(100),
});
const periodSchema = z.object({ priceInfo: priceInfoSchema, start: z.string().max(40), end: z.string().max(40) });
const pointsSchema = z.object({ points: z.array(z.object({ x: ratio, y: ratio })).max(MAX_CURVE_POINTS) });

/** 用到的欄位（其他欄位由 zod 去掉）。 */
const responseSchema = z.object({
  productId: z.string().max(20),
  lowestPrice: periodSchema.nullish(),
  recentSalePriceLog: z.array(periodSchema).max(MAX_SALES).nullish(),
  priceLogGraph: z.object({ graphs: z.unknown(), regularPrice: intIn(0, 1_000_000) }),
  discountDaysOfLastYear: z.number().int().min(0).max(366).nullish(),
  ebmInput: z.object({ sale_count: z.number().int().min(0).max(1_000_000).nullish() }).nullish(),
});

const YEAR_KEY = /^\d{4}$/;

/** 驗證過、還沒做合理性檢查的 DLWatcher 資料。 */
export interface DlwatcherData {
  id: string;
  lowest: { price: number; start: string; end: string } | null;
  sales: { price: number; rate: number; start: string; end: string }[];
  points: { year: number; x: number; y: number }[];
  regularPrice: number;
  discountDaysLastYear?: number;
  saleCount?: number;
}

export type ParseDlwatcherResult =
  { ok: true; data: DlwatcherData } | { ok: false; reason: 'unparsable' | 'invalid'; issues?: { path: string; code: string }[] };

/**
 * 解析 DLWatcher 的回應文字（§3.2.3）。任何一個用到的欄位不符就整份不用（§3.6：保留上一次的資料）。
 * 原始文字不 log、不放進錯誤（§3.3）。
 */
export function parseDlwatcherResponse(text: string, id: string): ParseDlwatcherResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'unparsable' };
  }
  const r = responseSchema.safeParse(raw);
  if (!r.success) return { ok: false, reason: 'invalid', issues: summarizeIssues(r.error) };
  const d = r.data;
  if (d.productId !== id) return { ok: false, reason: 'invalid', issues: [{ path: 'productId', code: 'mismatch' }] };

  const period = (p: z.output<typeof periodSchema>) => {
    const start = parseDlwatcherDate(p.start);
    const end = parseDlwatcherDate(p.end);
    return start && end ? { price: p.priceInfo.price, rate: Math.round(p.priceInfo.discountRate), start, end } : null;
  };
  let lowest: DlwatcherData['lowest'] = null;
  if (d.lowestPrice) {
    const p = period(d.lowestPrice);
    if (!p) return { ok: false, reason: 'invalid', issues: [{ path: 'lowestPrice', code: 'date' }] };
    lowest = { price: p.price, start: p.start, end: p.end };
  }
  const sales: DlwatcherData['sales'] = [];
  for (const s of d.recentSalePriceLog ?? []) {
    const p = period(s);
    if (!p) return { ok: false, reason: 'invalid', issues: [{ path: 'recentSalePriceLog', code: 'date' }] };
    sales.push(p);
  }

  // graphs 的 key 是年份：外部字串不當一般物件的 key（§3.2.3），用 Object.entries 逐一檢查。
  const graphs = d.priceLogGraph.graphs;
  if (graphs === null || typeof graphs !== 'object' || Array.isArray(graphs)) {
    return { ok: false, reason: 'invalid', issues: [{ path: 'priceLogGraph.graphs', code: 'type' }] };
  }
  const points: DlwatcherData['points'] = [];
  for (const [key, value] of Object.entries(graphs)) {
    const year = Number(key);
    if (!YEAR_KEY.test(key) || year < 2000 || year > 2100) {
      return { ok: false, reason: 'invalid', issues: [{ path: 'priceLogGraph.graphs', code: 'year' }] };
    }
    const g = pointsSchema.safeParse(value);
    if (!g.success) return { ok: false, reason: 'invalid', issues: summarizeIssues(g.error) };
    for (const p of g.data.points) points.push({ year, x: p.x, y: p.y });
    if (points.length > MAX_CURVE_POINTS) {
      return { ok: false, reason: 'invalid', issues: [{ path: 'priceLogGraph.graphs', code: 'too_big' }] };
    }
  }

  const data: DlwatcherData = { id, lowest, sales, points, regularPrice: d.priceLogGraph.regularPrice };
  if (d.discountDaysOfLastYear != null) data.discountDaysLastYear = d.discountDaysOfLastYear;
  if (d.ebmInput?.sale_count != null) data.saleCount = d.ebmInput.sale_count;
  return { ok: true, data };
}

const DAY = 24 * 3_600_000;

export type SanityFailure = 'regularPriceMismatch' | 'lowestTooHigh' | 'lowestTooLow' | 'badPeriod' | 'curveOutOfRange';

/**
 * §3.6 合理性檢查（防「格式正確但內容是假的」資料，例如網域換了持有者）。通過回傳 null。
 * `officialPrices`：DLsite 給的原價（自己的 priceLog 與目前的快照）。DLWatcher 的 regularPrice 也是它自己給的，
 * 不能單獨當基準：有 DLsite 的原價時，regularPrice 要在它們的 0.5～2 倍之間。
 * - lowest.price ≤ max(regularPrice, 見過的最大 officialPrice)，而且 ≥ floor(max(regularPrice, 見過的最大 officialPrice) × 0.05)
 * - 每段期間（史低與最近特價）：start ≤ end、start ≤ 現在 + 1 天、end ≤ 現在 + 400 天
 * - 走勢點的 x、y 都在 0～1
 */
export function checkDlwatcherSanity(data: DlwatcherData, officialPrices: readonly number[], nowMs: number): SanityFailure | null {
  const periodOk = (p: { start: string; end: string }) => {
    const s = isoToMs(p.start);
    const e = isoToMs(p.end);
    return s <= e && s <= nowMs + DAY && e <= nowMs + 400 * DAY;
  };
  const maxOfficial = officialPrices.reduce((m, v) => Math.max(m, v), 0);
  if (maxOfficial > 0) {
    const minOfficial = officialPrices.reduce((m, v) => Math.min(m, v), maxOfficial);
    if (data.regularPrice < minOfficial * 0.5 || data.regularPrice > maxOfficial * 2) return 'regularPriceMismatch';
  }
  if (data.lowest) {
    const reference = Math.max(data.regularPrice, maxOfficial);
    if (data.lowest.price > reference) return 'lowestTooHigh';
    if (data.lowest.price < Math.floor(reference * 0.05)) return 'lowestTooLow';
    if (!periodOk(data.lowest)) return 'badPeriod';
  }
  if (!data.sales.every(periodOk)) return 'badPeriod';
  if (!data.points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return 'curveOutOfRange';
  return null;
}

/**
 * §3.6：新的 lowest.price 比上次低超過 50%，而且自己的 priceLog 沒有看過差距 5% 以內的價格。
 * 史低沒變的話沿用上次的標示。
 */
export function isDivergent(data: DlwatcherData, prev: HistoryRecord | undefined, ownLog: readonly PriceLogEntry[]): boolean {
  if (!data.lowest || !prev?.lowest) return false;
  const p = data.lowest.price;
  if (p === prev.lowest.price) return prev.divergent === true;
  if (p >= prev.lowest.price * 0.5) return false;
  return !ownLog.some((e) => e.status === undefined && Math.abs(e.price - p) <= p * 0.05);
}

/** 通過合理性檢查的資料 → 存進 IndexedDB 的 HistoryRecord（走勢點換算成日期，§5.2）。 */
export function toHistoryRecord(data: DlwatcherData, fetchedAt: string, divergent: boolean): HistoryRecord {
  const curve = data.points
    .map((p) => ({ date: curvePointDate(p.year, p.x), ratio: p.y }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const rec: HistoryRecord = {
    id: data.id,
    lowest: data.lowest ? { ...data.lowest } : null,
    sales: data.sales.map((s) => ({ ...s })),
    curve,
    regularPrice: data.regularPrice,
    fetchedAt,
  };
  if (data.discountDaysLastYear !== undefined) rec.discountDaysLastYear = data.discountDaysLastYear;
  if (data.saleCount !== undefined) rec.saleCount = data.saleCount;
  if (divergent) rec.divergent = true;
  return rec;
}

/** 測試用：regex 本身（§3.2.6 ReDoS 測試直接對 regex 餵長字串）。 */
export const __regexForTest = { RATIO_RE, YEAR_KEY };
