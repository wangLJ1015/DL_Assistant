// 一次查價請求與寫入（background 專用）。排程、請求間隔與退避在 queue.ts（§4.1）。
import { apiGet } from './api/endpoints';
import { applyProductInfo, parseProductInfoResponse, toSnapshot, unavailableSnapshot, type ProductInfo } from './api/dlsite';
import { checkDlwatcherSanity, isDivergent, parseDlwatcherResponse, toHistoryRecord, type SanityFailure } from './api/dlwatcher';
import { appendPriceObservations, readHistory, readPriceLog, writeHistory } from './db';
import { nowIso } from './dates';
import { MAX_NOT_FOUND_COUNT, type TrackedItem } from './models';
import { observationFromSnapshot, priceLogGapMs, type PriceObservation } from './price-log';
import { readItems, readSettings, readSnapshots, writeQueue, writeStore } from './storage';

/** 一件作品這次查價的結果。 */
export type IdOutcome = { status: 'found' | 'missing' | 'invalid' } | { status: 'failed'; reason: string };

export type ProductBatchResult =
  | { kind: 'done'; outcomes: Map<string, IdOutcome> }
  /** 429／5xx，或整批都被 4xx 拒絕：退避後整批重試（§3.1）。 */
  | { kind: 'retry'; reason: string }
  /** 連不上（離線、逾時）：稍後整批重試，間隔隨連續次數加長。 */
  | { kind: 'network' }
  /** 回應無法解析等：這一輪跳過這批。 */
  | { kind: 'failed'; reason: string };

const isRetryStatus = (status: number) => status === 429 || status >= 500;

/** §4.1：找壞編號時最多多送幾個請求（100 件裡有 1 個壞編號約 14 個）。 */
export const MAX_SPLIT_REQUESTS = 16;

type Fetched =
  | { kind: 'ok'; found: Map<string, ProductInfo>; invalidIds: Set<string> }
  | { kind: 'rejected'; status: number }
  | { kind: 'other'; result: ProductBatchResult };

async function fetchBatch(batch: readonly string[]): Promise<Fetched> {
  const res = await apiGet('productInfo', { ids: batch });
  if (!res.ok) {
    if (res.kind === 'network') return { kind: 'other', result: { kind: 'network' } };
    if (res.kind === 'http' && isRetryStatus(res.status)) return { kind: 'other', result: { kind: 'retry', reason: `http${res.status}` } };
    if (res.kind === 'http' && res.status >= 400) return { kind: 'rejected', status: res.status };
    return { kind: 'other', result: { kind: 'failed', reason: res.kind === 'http' ? `http${res.status}` : res.kind } };
  }
  const parsed = parseProductInfoResponse(res.text, batch);
  if (!parsed.ok) return { kind: 'other', result: { kind: 'failed', reason: parsed.reason } };
  return { kind: 'ok', found: parsed.found, invalidIds: new Set(parsed.invalid.map((x) => x.id)) };
}

/**
 * 查一批作品的現價並寫回（§4.2：快照一次 set、priceLog 一個 transaction）。
 * 整批回傳 4xx（429 以外）時，拆成兩半找壞的編號（§4.1）：只有「一半成功、一半被拒絕」才證明是某個編號的問題，
 * 往被拒絕的那一半繼續拆，拆到剩一件就記成查不到。兩半都被拒絕、一開始就只有一件、或多送的請求超過上限，
 * 都代表整批被擋（WAF、改版），當作 429／5xx 退避，不把作品記成查不到。
 * `beforeExtraRequest`：每多送一個請求之前呼叫（維持請求間隔）。
 */
export async function checkProductBatch(batch: readonly string[], beforeExtraRequest: () => Promise<void>): Promise<ProductBatchResult> {
  const first = await fetchBatch(batch);
  if (first.kind === 'other') return first.result;
  if (first.kind === 'ok') return { kind: 'done', outcomes: await writeProductResults(batch, first.found, first.invalidIds) };
  const blocked: ProductBatchResult = { kind: 'retry', reason: `http${first.status}` };
  if (batch.length === 1) return blocked;

  const outcomes = new Map<string, IdOutcome>();
  let budget = MAX_SPLIT_REQUESTS;
  let suspects: readonly string[] = batch;
  while (suspects.length > 1) {
    if (budget < 2) return outcomes.size > 0 ? { kind: 'done', outcomes } : blocked;
    const mid = Math.ceil(suspects.length / 2);
    const halves = [suspects.slice(0, mid), suspects.slice(mid)];
    const results: Fetched[] = [];
    for (const half of halves) {
      await beforeExtraRequest();
      budget--;
      const r = await fetchBatch(half);
      if (r.kind === 'other') return r.result;
      results.push(r);
    }
    const rejected = results.map((r) => r.kind === 'rejected');
    if (rejected.every(Boolean)) return blocked;
    // 成功的那一半（兩半都成功：剛才的 4xx 是偶發的）照常寫回
    for (let i = 0; i < 2; i++) {
      const r = results[i]!;
      if (r.kind !== 'ok') continue;
      for (const [k, v] of await writeProductResults(halves[i]!, r.found, r.invalidIds)) outcomes.set(k, v);
    }
    const bad = rejected.indexOf(true);
    if (bad < 0) return { kind: 'done', outcomes };
    suspects = halves[bad]!;
  }
  // 剩下的一件：另一半成功、它被拒絕，記成查不到（§5.3）
  for (const [k, v] of await writeProductResults(suspects, new Map(), new Set())) outcomes.set(k, v);
  return { kind: 'done', outcomes };
}

/** 查不到（API 沒回傳、is_sold_out）時累加連續次數，查得到就清掉（§5.3）。 */
function withNotFoundCount(item: TrackedItem, notFound: boolean): TrackedItem {
  const { notFoundCount, ...rest } = item;
  if (!notFound) return rest;
  return { ...rest, notFoundCount: Math.min((notFoundCount ?? 0) + 1, MAX_NOT_FOUND_COUNT) };
}

async function writeProductResults(
  batch: readonly string[],
  found: ReadonlyMap<string, ProductInfo>,
  invalidIds: ReadonlySet<string>,
): Promise<Map<string, IdOutcome>> {
  const checkedAt = nowIso();
  return writeQueue(async () => {
    const [items, snapshots, settings] = await Promise.all([readItems(), readSnapshots(), readSettings()]);
    const outcomes = new Map<string, IdOutcome>();
    const observations: PriceObservation[] = [];
    for (const id of batch) {
      const item = items.get(id);
      if (!item) continue; // 查價途中被移除
      // §3.2.3：驗證失敗只讓這一筆失敗，不當成「查不到」，快照維持原樣。
      if (invalidIds.has(id)) {
        outcomes.set(id, { status: 'invalid' });
        continue;
      }
      const info = found.get(id);
      const prev = snapshots.get(id);
      const snap = info ? toSnapshot(info, prev, checkedAt) : unavailableSnapshot(prev, checkedAt);
      items.set(id, withNotFoundCount(info ? applyProductInfo(item, info) : item, !snap?.available));
      // §5.3：第一次查價就查不到時沒有可沿用的資料，不寫快照與 priceLog。
      if (snap) {
        snapshots.set(id, snap);
        observations.push(observationFromSnapshot(snap));
      }
      outcomes.set(id, { status: info ? 'found' : 'missing' });
    }
    await writeStore({ items, snapshots });
    await appendPriceObservations(observations, priceLogGapMs(settings.checkIntervalHours));
    return outcomes;
  });
}

export type DlwatcherOutcome =
  | { kind: 'saved' }
  /** 404：DLWatcher 沒有這件作品。保留上一次的資料。 */
  | { kind: 'notFound' }
  /** 驗證失敗、合理性檢查不通過、其他 4xx：保留上一次的資料（§3.6）。 */
  | { kind: 'rejected'; reason: 'unparsable' | 'invalid' | SanityFailure | string }
  | { kind: 'retry'; reason: string }
  | { kind: 'network' };

/**
 * 查一件作品的 DLWatcher 史低並寫進 IndexedDB（§3.6）：只有驗證成功、而且通過合理性檢查時才覆蓋，
 * 失敗時保留上一次的資料。
 */
export async function checkDlwatcherItem(id: string): Promise<DlwatcherOutcome> {
  const res = await apiGet('dlwatcher', { id });
  if (!res.ok) {
    if (res.kind === 'network') return { kind: 'network' };
    if (res.kind === 'http' && res.status === 404) return { kind: 'notFound' };
    if (res.kind === 'http' && isRetryStatus(res.status)) return { kind: 'retry', reason: `http${res.status}` };
    return { kind: 'rejected', reason: res.kind === 'http' ? `http${res.status}` : res.kind };
  }
  const parsed = parseDlwatcherResponse(res.text, id);
  if (!parsed.ok) return { kind: 'rejected', reason: parsed.reason };
  const fetchedAt = nowIso();
  return writeQueue(async (): Promise<DlwatcherOutcome> => {
    if (!(await readItems()).has(id)) return { kind: 'rejected', reason: 'notTracked' }; // 查詢途中被移除
    const [log, prev, snapshots] = await Promise.all([readPriceLog(id), readHistory(id), readSnapshots()]);
    // §3.6：原價的參考值來自 DLsite（自己的紀錄與目前的快照），不能只信 DLWatcher 自己給的 regularPrice。
    const officialPrices = log.map((e) => e.officialPrice);
    const snap = snapshots.get(id);
    if (snap) officialPrices.push(snap.officialPrice);
    const failure = checkDlwatcherSanity(parsed.data, officialPrices, Date.now());
    if (failure) return { kind: 'rejected', reason: failure };
    await writeHistory(toHistoryRecord(parsed.data, fetchedAt, isDivergent(parsed.data, prev, log)));
    return { kind: 'saved' };
  });
}
