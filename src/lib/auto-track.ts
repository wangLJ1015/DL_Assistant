// content script 送來的自動加入（F1、F2、作品頁的「加入追蹤」）。background 專用。
// §3.2.4：每日上限、一次 cartSnapshot 的新增上限、同一個 documentId 只接受一次。
import { browser } from 'wxt/browser';
import { z } from 'zod';
import { isoToMs, jstDate, msToIso, nowIso } from './dates';
import { CART_SNAPSHOT_MAX_NEW, DAILY_AUTO_ADD_LIMIT, isoSchema, MAX_TRACKED_ITEMS } from './models';
import { readDailyAutoAdd, readItems, SESSION_KEYS, writeQueue, writeStore } from './storage';
import { newTrackedItem, refreshPrices } from './tracking';

// ---- 同一個 documentId 只接受一次（storage.session 的 seenDocuments）----

export const SEEN_KINDS = ['badge', 'cart', 'track'] as const;
export type SeenKind = (typeof SEEN_KINDS)[number];
const SEEN_MAX = 500;
const SEEN_TTL_MS = 60 * 60 * 1000;

const seenListSchema = z.array(z.tuple([z.string().min(1).max(100), isoSchema])).max(SEEN_MAX);
type SeenList = z.infer<typeof seenListSchema>;

async function readSeen(): Promise<Record<SeenKind, SeenList>> {
  const got = await browser.storage.session.get(SESSION_KEYS.seenDocuments);
  const raw: unknown = got[SESSION_KEYS.seenDocuments];
  const out: Record<SeenKind, SeenList> = { badge: [], cart: [], track: [] };
  if (raw === null || typeof raw !== 'object') return out;
  for (const kind of SEEN_KINDS) {
    const r = seenListSchema.safeParse(Object.hasOwn(raw, kind) ? (raw as Record<string, unknown>)[kind] : undefined);
    if (r.success) out[kind] = r.data;
  }
  return out;
}

/**
 * 這個 documentId 第一次送這種訊息時回傳 true 並記下；之後回傳 false。
 * 各保留最近 500 筆，超過 1 小時的刪除。service worker 重啟後仍有效（存在 storage.session）。
 */
export function claimDocument(kind: SeenKind, documentId: string | undefined): Promise<boolean> {
  return writeQueue(async () => {
    if (documentId === undefined || documentId === '' || documentId.length > 100) return false;
    const seen = await readSeen();
    const now = Date.now();
    const list = seen[kind].filter(([, at]) => now - isoToMs(at) < SEEN_TTL_MS);
    if (list.some(([d]) => d === documentId)) return false;
    list.push([documentId, msToIso(now)]);
    seen[kind] = list.slice(-SEEN_MAX);
    await browser.storage.session.set({ [SESSION_KEYS.seenDocuments]: seen });
    return true;
  });
}

// ---- 自動加入 ----

export interface AutoTrackResult {
  added: string[];
  /** 因為每日上限、一次的新增上限或追蹤清單上限而沒有加入的件數。 */
  skipped: number;
}

export interface AutoTrackOptions {
  /** 這次最多新增幾件（cartSnapshot 是 50）。 */
  maxNew?: number;
  /** 同一次寫入順便記下 lastCart（cartSnapshot）。 */
  lastCartIds?: string[];
}

/**
 * 把 content script 送來的作品加入追蹤清單（`source` 由 background 依訊息決定：cart 或 page）。
 * 已經在清單裡的不算新增，也不計入每日上限。加入後在背景查價，不等結果。
 */
export async function autoTrack(ids: readonly string[], source: 'cart' | 'page', opts: AutoTrackOptions = {}): Promise<AutoTrackResult> {
  const maxNew = opts.maxNew ?? Number.POSITIVE_INFINITY;
  const result = await writeQueue(async (): Promise<AutoTrackResult> => {
    const now = nowIso();
    const [items, daily] = await Promise.all([readItems(), readDailyAutoAdd(jstDate(now))]);
    const added: string[] = [];
    let skipped = 0;
    for (const id of new Set(ids)) {
      if (items.has(id)) continue;
      if (added.length >= maxNew || daily.count >= DAILY_AUTO_ADD_LIMIT || items.size >= MAX_TRACKED_ITEMS) {
        skipped++;
        continue;
      }
      items.set(id, newTrackedItem(id, source));
      added.push(id);
      daily.count++;
    }
    daily.skipped = Math.min(daily.skipped + skipped, 100_000);
    await writeStore({
      ...(added.length > 0 ? { items } : {}),
      ...(added.length > 0 || skipped > 0 ? { dailyAutoAdd: daily } : {}),
      ...(opts.lastCartIds ? { lastCart: { ids: [...opts.lastCartIds], at: now } } : {}),
    });
    return { added, skipped };
  });
  if (result.added.length > 0) void refreshPrices(result.added).catch(() => undefined);
  return result;
}

export { CART_SNAPSHOT_MAX_NEW };
