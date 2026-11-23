// 追蹤清單與查價（background 專用）。M1：手動加入／移除、商品 API 查價。
// 佇列、退避（§4.1）在 M3，通知規則（§6.1）在 M4。
import { apiGet } from './api/endpoints';
import { applyProductInfo, parseProductInfoResponse, toSnapshot, unavailableSnapshot } from './api/dlsite';
import { nowIso } from './dates';
import { isWorkId } from './ids';
import { MAX_NOT_FOUND_COUNT, MAX_TRACKED_ITEMS, type Settings, type TrackedItem } from './models';
import type { WriteReply } from './messages';
import { readItems, readSettings, readSnapshots, readUntracked, writeQueue, writeStore } from './storage';

const PRODUCT_API_INTERVAL_MS = 1000; // §3.1 請求之間間隔至少 1 秒
const PRODUCT_API_BATCH = 100;

let nextProductRequestAt = 0;

/** 測試用：清掉請求間隔的計時。 */
export function __resetThrottleForTest(): void {
  nextProductRequestAt = 0;
}

async function waitForProductSlot(): Promise<void> {
  const now = Date.now();
  const wait = nextProductRequestAt - now;
  nextProductRequestAt = Math.max(now, nextProductRequestAt) + PRODUCT_API_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export type TrackSource = TrackedItem['source'];

/** 新加入的追蹤項目。名稱、圖片、分站在第一次查價後補上（§5.3）。 */
export function newTrackedItem(id: string, source: TrackSource): TrackedItem {
  return {
    id,
    site: 'maniax',
    title: '',
    imageUrl: '',
    addedAt: nowIso(),
    source,
    autoAdded: source === 'cart' || source === 'page',
    paused: false,
  };
}

export interface TrackOptions {
  /** true：第一次查價做完才回覆（擴充功能頁面）。content script 的 track 不等（M2）。 */
  awaitPrice?: boolean;
}

export async function trackItem(id: string, source: TrackSource, opts: TrackOptions = {}): Promise<WriteReply> {
  if (!isWorkId(id)) return { ok: false, reason: 'invalidId' };
  const reply = await writeQueue(async (): Promise<WriteReply & { check?: boolean }> => {
    const items = await readItems();
    // 已在清單裡但還沒有價格（第一次查價失敗）時，再加一次就重新查價。
    if (items.has(id)) return { ok: true, check: !(await readSnapshots()).has(id) };
    if (items.size >= MAX_TRACKED_ITEMS) return { ok: false, reason: 'limit' };
    items.set(id, newTrackedItem(id, source));
    // 使用者自己加回來：清掉移除紀錄
    const untracked = await readUntracked();
    const hadTombstone = untracked.delete(id);
    await writeStore({ items, ...(hadTombstone ? { untracked } : {}) });
    return { ok: true, check: true };
  });
  if (reply.ok && reply.check) {
    // 查價結果透過 storage.onChanged 更新畫面；失敗時畫面顯示「還沒有價格」與「重新查價」。
    const job = refreshPrices([id]).catch((): RefreshResult => ({ ok: false, reason: 'failed' }));
    if (opts.awaitPrice) await job;
  }
  return reply.ok ? { ok: true } : reply;
}

export async function untrackItem(id: string): Promise<WriteReply> {
  return writeQueue(async () => {
    const [items, snapshots, untracked] = await Promise.all([readItems(), readSnapshots(), readUntracked()]);
    if (!items.delete(id)) return { ok: true };
    snapshots.delete(id);
    // 移除紀錄：購物車頁同步不會再把它加回來（§5.3 untracked）
    untracked.delete(id);
    untracked.set(id, nowIso());
    await writeStore({ items, snapshots, untracked });
    return { ok: true };
  });
}

export type RefreshResult = { ok: true; updated: number; missing: number; invalid: number } | { ok: false; reason: string };

/** 查詢商品 API 並更新快照。暫停中的作品略過（§4.1）。 */
export async function refreshPrices(ids: readonly string[]): Promise<RefreshResult> {
  const items = await readItems();
  const targets = [...new Set(ids)].filter((id) => items.get(id)?.paused === false);
  let updated = 0;
  let missing = 0;
  let invalid = 0;
  for (let i = 0; i < targets.length; i += PRODUCT_API_BATCH) {
    const batch = targets.slice(i, i + PRODUCT_API_BATCH);
    await waitForProductSlot();
    const res = await apiGet('productInfo', { ids: batch });
    if (!res.ok) return { ok: false, reason: res.kind === 'http' ? `http${res.status}` : res.kind };
    const parsed = parseProductInfoResponse(res.text, batch);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    const checkedAt = nowIso();
    const invalidIds = new Set(parsed.invalid.map((x) => x.id));
    await writeQueue(async () => {
      const [curItems, snapshots] = await Promise.all([readItems(), readSnapshots()]);
      for (const id of batch) {
        const item = curItems.get(id);
        if (!item) continue; // 查價途中被移除
        // §3.2.3：驗證失敗只讓這一筆失敗，不當成「查不到」，快照維持原樣。
        if (invalidIds.has(id)) continue;
        const info = parsed.found.get(id);
        const prev = snapshots.get(id);
        const snap = info ? toSnapshot(info, prev, checkedAt) : unavailableSnapshot(prev, checkedAt);
        const next = info ? applyProductInfo(item, info) : item;
        curItems.set(id, withNotFoundCount(next, !snap?.available));
        if (snap) snapshots.set(id, snap);
      }
      await writeStore({ items: curItems, snapshots });
    });
    updated += parsed.found.size;
    missing += parsed.missing.length;
    invalid += invalidIds.size;
  }
  return { ok: true, updated, missing, invalid };
}

/** 查不到（API 沒回傳、is_sold_out）時累加連續次數，查得到就清掉（§5.3）。 */
function withNotFoundCount(item: TrackedItem, notFound: boolean): TrackedItem {
  const { notFoundCount, ...rest } = item;
  if (!notFound) return rest;
  return { ...rest, notFoundCount: Math.min((notFoundCount ?? 0) + 1, MAX_NOT_FOUND_COUNT) };
}

export async function updateSettings(partial: Partial<Settings>): Promise<WriteReply> {
  return writeQueue(async () => {
    const cur = await readSettings();
    const next: Settings = { ...cur };
    for (const [k, v] of Object.entries(partial) as [keyof Settings, unknown][]) {
      if (v !== undefined) (next as Record<string, unknown>)[k] = k === 'rules' ? { ...(v as Settings['rules']) } : v;
    }
    await writeStore({ settings: next });
    return { ok: true };
  });
}
