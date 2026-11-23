// §4.2 storage 存取層。讀取：擴充功能頁面與 background；寫入：只有 background（透過 writeQueue）。
// content script 不能 import 這個檔案（§3.2.5，ESLint 強制）。
import { browser } from 'wxt/browser';
import {
  defaultSettings,
  priceSnapshotSchema,
  settingsSchema,
  trackedItemSchema,
  type PriceSnapshot,
  type Settings,
  type TrackedItem,
} from './models';

export const STORAGE_KEYS = {
  settings: 'settings',
  items: 'items',
  snapshots: 'snapshots',
} as const;

/** storage 讀回的陣列逐筆驗證，失敗的丟棄；以作品編號為 key 放進 Map（§3.2.3）。 */
function toValidatedMap<T extends { id: string }>(
  raw: unknown,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
): Map<string, T> {
  const map = new Map<string, T>();
  if (!Array.isArray(raw)) return map;
  for (const v of raw) {
    const r = schema.safeParse(v);
    if (r.success && !map.has(r.data.id)) map.set(r.data.id, r.data);
  }
  return map;
}

/** 設定：缺少的欄位補預設值；整份不符就用預設值。 */
export function parseSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base) as (keyof Settings)[]) {
    if (Object.hasOwn(raw, key)) merged[key] = (raw as Record<string, unknown>)[key];
  }
  if (Object.hasOwn(raw, 'dlwatcherAutoPausedAt')) merged.dlwatcherAutoPausedAt = (raw as Record<string, unknown>).dlwatcherAutoPausedAt;
  const r = settingsSchema.safeParse(merged);
  return r.success ? r.data : base;
}

export async function readSettings(): Promise<Settings> {
  const got = await browser.storage.local.get(STORAGE_KEYS.settings);
  return parseSettings(got[STORAGE_KEYS.settings]);
}

export async function readItems(): Promise<Map<string, TrackedItem>> {
  const got = await browser.storage.local.get(STORAGE_KEYS.items);
  return toValidatedMap(got[STORAGE_KEYS.items], trackedItemSchema);
}

export async function readSnapshots(): Promise<Map<string, PriceSnapshot>> {
  const got = await browser.storage.local.get(STORAGE_KEYS.snapshots);
  return toValidatedMap(got[STORAGE_KEYS.snapshots], priceSnapshotSchema);
}

// ---- 寫入（只在 background 使用）----

/**
 * 讓「讀 → 改 → 寫」依序執行的 Promise 佇列（§4.2）。前一個工作失敗不影響下一個。
 */
export function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}

export const writeQueue = createWriteQueue();

export interface StorePatch {
  settings?: Settings;
  items?: Map<string, TrackedItem>;
  snapshots?: Map<string, PriceSnapshot>;
}

/** 一次 set 寫入多個 key（§4.2 一批一次寫入）。Map 存成陣列。 */
export async function writeStore(patch: StorePatch): Promise<void> {
  const out: Record<string, unknown> = {};
  if (patch.settings) out[STORAGE_KEYS.settings] = patch.settings;
  if (patch.items) out[STORAGE_KEYS.items] = [...patch.items.values()];
  if (patch.snapshots) out[STORAGE_KEYS.snapshots] = [...patch.snapshots.values()];
  if (Object.keys(out).length > 0) await browser.storage.local.set(out);
}

/** content script 不能直接讀寫 storage.local（§4.2）。每次 service worker 啟動與 onInstalled 都呼叫。 */
export async function lockStorageToTrustedContexts(): Promise<void> {
  await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
