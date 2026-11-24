// 史低與走勢的計算（§3.6）。擴充功能頁面與 background 共用的純函式。
import { isoToMs } from './dates';
import type { HistoryRecord, PriceLogEntry, Settings } from './models';

/** DLWatcher 是否在使用中：設定沒有關閉，也沒有被自動暫停（§3.6）。 */
export function isDlwatcherActive(s: Settings): boolean {
  return s.dlwatcherEnabled && s.dlwatcherAutoPausedAt === undefined;
}

export interface OwnLowest {
  price: number;
  /** 這個價格那一筆紀錄的期間（第一次查到 → 最後一次查到）。 */
  start: string;
  end: string;
  /** 「自 YYYY-MM-DD 開始追蹤以來」：status 為空的第一筆 at（§3.6，不用 TrackedItem.addedAt）。 */
  since: string;
}

/** 自己紀錄的最低價：只計算 status 為空的紀錄（§3.6）。同價時取最近的一段。 */
export function ownLowest(log: readonly PriceLogEntry[]): OwnLowest | undefined {
  let best: PriceLogEntry | undefined;
  let first: PriceLogEntry | undefined;
  for (const e of log) {
    if (e.status !== undefined) continue;
    if (!first || e.at < first.at) first = e;
    if (!best || e.price < best.price || (e.price === best.price && e.at > best.at)) best = e;
  }
  if (!best || !first) return undefined;
  return { price: best.price, start: best.at, end: best.lastSeenAt, since: first.at };
}

export interface LowestSummary {
  /** DLWatcher 的史低。關閉或暫停 DLWatcher 時不顯示（§3.6）。 */
  dlwatcher?: { price: number; start: string; end: string; fetchedAt: string; divergent: boolean };
  /** 自己紀錄的最低價（兩個數字並列顯示，不只顯示合併後的值，§3.6）。 */
  own?: OwnLowest;
  /** 合併後的史低：兩者取低。 */
  best?: { price: number; source: 'dlwatcher' | 'own' };
}

export function summarizeLowest(history: HistoryRecord | undefined, log: readonly PriceLogEntry[], settings: Settings): LowestSummary {
  const out: LowestSummary = {};
  if (isDlwatcherActive(settings) && history?.lowest) {
    out.dlwatcher = { ...history.lowest, fetchedAt: history.fetchedAt, divergent: history.divergent === true };
  }
  const own = ownLowest(log);
  if (own) out.own = own;
  if (out.dlwatcher && (!own || out.dlwatcher.price <= own.price)) out.best = { price: out.dlwatcher.price, source: 'dlwatcher' };
  else if (own) out.best = { price: own.price, source: 'own' };
  return out;
}

/** 走勢圖的一段（§3.6）。price 為 null：查不到（不畫價格）。 */
export interface TrendSegment {
  from: string;
  to: string;
  price: number | null;
  /** seen：實際查到；gap：沒有查價的期間（上一筆的 lastSeenAt 到下一筆的 at），畫虛線；curve：DLWatcher 的走勢點。 */
  kind: 'seen' | 'gap' | 'curve';
}

export interface Trend {
  source: 'dlwatcher' | 'own';
  segments: TrendSegment[];
}

/**
 * 自己的紀錄畫成階梯折線（§3.6）：每一筆是 at → lastSeenAt 的水平線；兩筆之間（上一筆 lastSeenAt 到下一筆 at）
 * 沒有查價，畫成虛線，不假裝價格沒變。虛線的價格接續上一筆（查不到的那一筆則不畫價格）。
 */
export function ownTrend(log: readonly PriceLogEntry[]): TrendSegment[] {
  const sorted = [...log].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const out: TrendSegment[] = [];
  sorted.forEach((e, i) => {
    const price = e.status === undefined ? e.price : null;
    out.push({ from: e.at, to: e.lastSeenAt, price, kind: 'seen' });
    const next = sorted[i + 1];
    if (next && isoToMs(next.at) > isoToMs(e.lastSeenAt)) out.push({ from: e.lastSeenAt, to: next.at, price, kind: 'gap' });
  });
  return out;
}

/** DLWatcher 的走勢點 → 階梯折線（價格 = Math.round(ratio × regularPrice)，§5.2）。 */
export function dlwatcherTrend(h: HistoryRecord): TrendSegment[] {
  return h.curve.map((p, i) => ({
    from: p.date,
    to: h.curve[i + 1]?.date ?? h.fetchedAt,
    price: Math.round(p.ratio * h.regularPrice),
    kind: 'curve' as const,
  }));
}

/** DLWatcher 使用中而且有走勢點就用它，否則用自己的紀錄（§3.6）。 */
export function buildTrend(history: HistoryRecord | undefined, log: readonly PriceLogEntry[], settings: Settings): Trend {
  if (isDlwatcherActive(settings) && history && history.curve.length > 0) {
    return { source: 'dlwatcher', segments: dlwatcherTrend(history) };
  }
  return { source: 'own', segments: ownTrend(log) };
}
