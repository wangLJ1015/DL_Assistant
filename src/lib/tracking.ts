// 追蹤清單的加入／移除與查價（background 專用）。
// 查價本身排進 §4.1 的佇列（queue.ts），請求、寫入與通知規則（§6.1）在 price-check.ts。
import { isoToMs, nowIso } from './dates';
import { isWorkId } from './ids';
import { MAX_TRACKED_ITEMS, WORK_RULES, type Settings, type TrackedItem } from './models';
import type { WriteReply } from './messages';
import { enqueueDlwatcher, kick, rescheduleCheck, requestChecks } from './queue';
import { ruleStateKey, targetStateFor } from './rules';
import {
  RECHECK_COOLDOWN_MS,
  readItems,
  readRecheckAt,
  readRuleState,
  readSettings,
  readSnapshots,
  readUntracked,
  writeQueue,
  writeStore,
} from './storage';

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
    const job = requestChecks([id], { awaitProduct: opts.awaitPrice, dlwatcher: true }).catch(() => undefined);
    if (opts.awaitPrice) await job;
  }
  return reply.ok ? { ok: true } : reply;
}

/** content script 自動加入的作品：排進佇列，不等結果。 */
export function checkNewItems(ids: readonly string[]): void {
  if (ids.length === 0) return;
  void requestChecks(ids, { dlwatcher: true }).catch((e: unknown) => console.warn('[DL_Assistant] 自動加入後的查價失敗', e));
}

export async function untrackItem(id: string): Promise<WriteReply> {
  return writeQueue(async () => {
    const [items, snapshots, untracked, ruleState] = await Promise.all([readItems(), readSnapshots(), readUntracked(), readRuleState()]);
    if (!items.delete(id)) return { ok: true };
    // §4.2 清理：快照與 RuleState 刪掉；priceLog 與 DLWatcher 的歷史保留（重新追蹤時還能用）。
    snapshots.delete(id);
    for (const rule of WORK_RULES) ruleState.delete(ruleStateKey('work', id, rule));
    // 移除紀錄：購物車頁同步不會再把它加回來（§5.3 untracked）
    untracked.delete(id);
    untracked.set(id, nowIso());
    await writeStore({ items, snapshots, untracked, ruleState });
    return { ok: true };
  });
}

/**
 * `setPaused {id, paused}`（F3）：暫停 = 不查價、不通知（§5.3）。恢復時清掉 baselineAt，
 * 下一次查價重新建立基準、不發通知（§6.1 第 6 步），並馬上排一次查價。
 */
export async function setPaused(id: string, paused: boolean): Promise<WriteReply> {
  const r = await writeQueue(async (): Promise<WriteReply & { resumed?: boolean }> => {
    const items = await readItems();
    const item = items.get(id);
    if (!item) return { ok: false, reason: 'notTracked' };
    if (item.paused === paused) return { ok: true };
    const { baselineAt: _, ...rest } = item;
    items.set(id, paused ? { ...item, paused: true } : { ...rest, paused: false });
    await writeStore({ items });
    return { ok: true, resumed: !paused };
  });
  if (r.ok && r.resumed) void requestChecks([id], { dlwatcher: true }).catch(() => undefined);
  return r.ok ? { ok: true } : r;
}

/**
 * `setTarget {id, price?}`（§3.2.4、§6）：設定或清掉目標價，並用目前的快照重算 `target` 的狀態：
 * 已經低於目標價就記成成立、不通知（剛設定就知道了）。
 */
export async function setTarget(id: string, price: number | undefined): Promise<WriteReply> {
  return writeQueue(async () => {
    const [items, snapshots, ruleState] = await Promise.all([readItems(), readSnapshots(), readRuleState()]);
    const item = items.get(id);
    if (!item) return { ok: false, reason: 'notTracked' };
    const { targetPrice: _, ...rest } = item;
    items.set(id, price === undefined ? rest : { ...rest, targetPrice: price });
    const key = ruleStateKey('work', id, 'target');
    const st = targetStateFor(snapshots.get(id), price, ruleState.get(key), nowIso());
    if (st) ruleState.set(key, st);
    else ruleState.delete(key);
    await writeStore({ items, ruleState });
    return { ok: true };
  });
}

export type RefreshResult = { ok: true; updated: number; missing: number; invalid: number } | { ok: false; reason: string };

/**
 * 立即查價：排到商品 API 佇列最前面，照樣套用請求間隔與退避（§3.2.4），等查完才回傳。
 * 暫停中與不在清單裡的作品略過（§4.1）。
 */
export async function refreshPrices(ids: readonly string[]): Promise<RefreshResult> {
  const items = await readItems();
  const targets = [...new Set(ids)].filter((id) => items.get(id)?.paused === false);
  if (targets.length === 0) return { ok: true, updated: 0, missing: 0, invalid: 0 };
  const outcomes = (await requestChecks(targets, { awaitProduct: true }))!;
  let updated = 0;
  let missing = 0;
  let invalid = 0;
  for (const o of outcomes.values()) {
    if (o.status === 'failed') return { ok: false, reason: o.reason };
    if (o.status === 'found') updated++;
    else if (o.status === 'missing') missing++;
    else invalid++;
  }
  return { ok: true, updated, missing, invalid };
}

/**
 * `recheck {ids}`（§3.2.4）：ids 都必須在追蹤清單裡，而且沒有暫停；同一件作品 10 分鐘內只重新查價一次。
 * 這次沒有真的送出請求（排隊中、退避中）時把冷卻還回去，使用者稍後可以再按。
 */
export async function recheck(ids: readonly string[]): Promise<WriteReply> {
  const due = await writeQueue(async (): Promise<{ id: string; at: string }[] | WriteReply> => {
    const [items, recheckAt] = await Promise.all([readItems(), readRecheckAt()]);
    if (!ids.every((id) => items.has(id))) return { ok: false, reason: 'notTracked' };
    if (ids.some((id) => items.get(id)?.paused)) return { ok: false, reason: 'paused' };
    const now = Date.now();
    const due = [...new Set(ids)].filter((id) => {
      const last = recheckAt.get(id);
      return !last || now - isoToMs(last) >= RECHECK_COOLDOWN_MS;
    });
    if (due.length === 0) return { ok: false, reason: 'cooldown' };
    const at = nowIso();
    for (const id of due) {
      recheckAt.delete(id);
      recheckAt.set(id, at);
    }
    await writeStore({ recheckAt });
    return due.map((id) => ({ id, at }));
  });
  if (!Array.isArray(due)) return due;
  const r = await refreshPrices(due.map((d) => d.id));
  if (!r.ok && (r.reason === 'queued' || r.reason === 'backoff')) {
    await writeQueue(async () => {
      const recheckAt = await readRecheckAt();
      for (const d of due) if (recheckAt.get(d.id) === d.at) recheckAt.delete(d.id);
      await writeStore({ recheckAt });
    });
  }
  if (!r.ok) return r;
  return r.invalid > 0 ? { ok: false, reason: 'invalidData' } : { ok: true };
}

export async function updateSettings(partial: Partial<Settings>): Promise<WriteReply> {
  const { before, after } = await writeQueue(async () => {
    const cur = await readSettings();
    const next: Settings = { ...cur };
    for (const [k, v] of Object.entries(partial) as [keyof Settings, unknown][]) {
      if (v !== undefined) (next as Record<string, unknown>)[k] = k === 'rules' ? { ...(v as Settings['rules']) } : v;
    }
    await writeStore({ settings: next });
    return { before: cur, after: next };
  });
  // §3.2.4：改查價週期時重建 alarm。
  if (after.checkIntervalHours !== before.checkIntervalHours) await rescheduleCheck(after);
  // 重新開啟 DLWatcher：補查 23 小時內沒請求過的作品（關閉時佇列由 queue.ts 清掉）。
  if (after.dlwatcherEnabled && !before.dlwatcherEnabled) await refillDlwatcher();
  return { ok: true };
}

/** `resumeDlwatcher`（§3.6）：使用者手動重新開啟被自動暫停的 DLWatcher。 */
export async function resumeDlwatcher(): Promise<WriteReply> {
  await writeQueue(async () => {
    const { dlwatcherAutoPausedAt: _, ...rest } = await readSettings();
    await writeStore({ settings: rest, dlwatcherHealth: {} });
  });
  await refillDlwatcher();
  return { ok: true };
}

async function refillDlwatcher(): Promise<void> {
  const items = await readItems();
  await enqueueDlwatcher([...items.values()].filter((i) => !i.paused).map((i) => i.id));
  void kick();
}
