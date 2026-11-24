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
  /** 429／5xx：退避後整批重試（§3.1）。 */
  | { kind: 'retry'; reason: string }
  /** 連不上：稍後整批重試，不計入退避。 */
  | { kind: 'network' }
  /** 回應無法解析等：這一輪跳過這批。 */
  | { kind: 'failed'; reason: string };

const isRetryStatus = (status: number) => status === 429 || status >= 500;

/**
 * 查一批作品的現價並寫回（§4.2：快照一次 set、priceLog 一個 transaction）。
 * 整批回傳 4xx（429 以外）時拆成兩半重試，找出壞的編號並記成查不到，不計入退避（§4.1）。
 * `beforeExtraRequest`：拆批後每多送一個請求之前呼叫（維持請求間隔）。
 */
export async function checkProductBatch(batch: readonly string[], beforeExtraRequest: () => Promise<void>): Promise<ProductBatchResult> {
  const res = await apiGet('productInfo', { ids: batch });
  if (!res.ok) {
    if (res.kind === 'network') return { kind: 'network' };
    if (res.kind === 'http' && isRetryStatus(res.status)) return { kind: 'retry', reason: `http${res.status}` };
    if (res.kind === 'http' && res.status >= 400) {
      if (batch.length === 1) return { kind: 'done', outcomes: await writeProductResults(batch, new Map(), new Set()) };
      const mid = Math.ceil(batch.length / 2);
      const outcomes = new Map<string, IdOutcome>();
      for (const half of [batch.slice(0, mid), batch.slice(mid)]) {
        await beforeExtraRequest();
        const r = await checkProductBatch(half, beforeExtraRequest);
        if (r.kind !== 'done') return r;
        for (const [k, v] of r.outcomes) outcomes.set(k, v);
      }
      return { kind: 'done', outcomes };
    }
    return { kind: 'failed', reason: res.kind === 'http' ? `http${res.status}` : res.kind };
  }
  const parsed = parseProductInfoResponse(res.text, batch);
  if (!parsed.ok) return { kind: 'failed', reason: parsed.reason };
  const invalidIds = new Set(parsed.invalid.map((x) => x.id));
  return { kind: 'done', outcomes: await writeProductResults(batch, parsed.found, invalidIds) };
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
    const [log, prev] = await Promise.all([readPriceLog(id), readHistory(id)]);
    const failure = checkDlwatcherSanity(parsed.data, log, Date.now());
    if (failure) return { kind: 'rejected', reason: failure };
    await writeHistory(toHistoryRecord(parsed.data, fetchedAt, isDivergent(parsed.data, prev, log)));
    return { kind: 'saved' };
  });
}
