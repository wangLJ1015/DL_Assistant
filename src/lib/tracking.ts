// 追蹤清單與查價（background 專用）。M1：手動加入／移除、商品 API 查價。
// 佇列、退避（§4.1）在 M3，通知規則（§6.1）在 M4。
import { apiGet } from './api/endpoints';
import { applyProductInfo, parseProductInfoResponse, toSnapshot, unavailableSnapshot } from './api/dlsite';
import { nowIso } from './dates';
import { isWorkId } from './ids';
import { MAX_TRACKED_ITEMS, type Settings, type TrackedItem } from './models';
import type { WriteReply } from './messages';
import { readItems, readSettings, readSnapshots, writeQueue, writeStore } from './storage';

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

export async function trackItem(id: string, source: TrackSource): Promise<WriteReply> {
  if (!isWorkId(id)) return { ok: false, reason: 'invalidId' };
  const reply = await writeQueue(async (): Promise<WriteReply & { added?: boolean }> => {
    const items = await readItems();
    if (items.has(id)) return { ok: true };
    if (items.size >= MAX_TRACKED_ITEMS) return { ok: false, reason: 'limit' };
    items.set(id, {
      id,
      site: 'maniax',
      title: '',
      imageUrl: '',
      addedAt: nowIso(),
      source,
      autoAdded: source === 'cart' || source === 'page',
      paused: false,
    });
    await writeStore({ items });
    return { ok: true, added: true };
  });
  if (reply.ok && reply.added) {
    // 不等查價完成就回覆；查價結果透過 storage.onChanged 更新畫面。
    void refreshPrices([id]).catch(() => undefined);
  }
  return reply.ok ? { ok: true } : reply;
}

export async function untrackItem(id: string): Promise<WriteReply> {
  return writeQueue(async () => {
    const [items, snapshots] = await Promise.all([readItems(), readSnapshots()]);
    if (!items.delete(id)) return { ok: true };
    snapshots.delete(id);
    await writeStore({ items, snapshots });
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
    await writeQueue(async () => {
      const [curItems, snapshots] = await Promise.all([readItems(), readSnapshots()]);
      for (const id of batch) {
        const item = curItems.get(id);
        if (!item) continue; // 查價途中被移除
        const info = parsed.found.get(id);
        const prev = snapshots.get(id);
        const snap = info ? toSnapshot(info, prev, checkedAt) : unavailableSnapshot(prev, checkedAt);
        if (info) curItems.set(id, applyProductInfo(item, info));
        if (snap) snapshots.set(id, snap);
      }
      await writeStore({ items: curItems, snapshots });
    });
    updated += parsed.found.size;
    missing += parsed.missing.length;
    invalid += new Set(parsed.invalid.map((x) => x.id)).size;
  }
  return { ok: true, updated, missing, invalid };
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
