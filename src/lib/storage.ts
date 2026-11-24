// §4.2 storage 存取層。讀取：擴充功能頁面與 background；寫入：只有 background（透過 writeQueue）。
// content script 不能 import 這個檔案（§3.2.5，ESLint 強制）。
import { browser } from 'wxt/browser';
import { z } from 'zod';
import { isoToMs, nowIso } from './dates';
import {
  backoffSchema,
  dailyAutoAddSchema,
  dlwatcherHealthSchema,
  queuesSchema,
  type Backoff,
  type DlwatcherHealth,
  type Queues,
  defaultSettings,
  lastCartSchema,
  type DailyAutoAdd,
  type LastCart,
  isoSchema,
  priceSnapshotSchema,
  workIdSchema,
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
  dailyAutoAdd: 'dailyAutoAdd',
  lastCart: 'lastCart',
  untracked: 'untracked',
  queues: 'queues',
  backoff: 'backoff',
  lastRunAt: 'lastRunAt',
  dlwatcherHealth: 'dlwatcherHealth',
  dlwatcherLastRequest: 'dlwatcherLastRequest',
  recheckAt: 'recheckAt',
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

/** 今天（JST）的自動新增計數；日期不同或資料不符時從 0 開始。 */
export async function readDailyAutoAdd(today: string): Promise<DailyAutoAdd> {
  const got = await browser.storage.local.get(STORAGE_KEYS.dailyAutoAdd);
  const r = dailyAutoAddSchema.safeParse(got[STORAGE_KEYS.dailyAutoAdd]);
  return r.success && r.data.date === today ? r.data : { date: today, count: 0, skipped: 0 };
}

export async function readLastCart(): Promise<LastCart | undefined> {
  const got = await browser.storage.local.get(STORAGE_KEYS.lastCart);
  const r = lastCartSchema.safeParse(got[STORAGE_KEYS.lastCart]);
  return r.success ? r.data : undefined;
}

/**
 * `untracked`：使用者自己移除的作品與移除時間（§5.3）。購物車頁同步（F2）不會把它們加回來；
 * 使用者再按一次加入購物車、手動加入時才清掉。最多 1,000 筆、保留 180 天。
 */
export const UNTRACKED_MAX = 1000;
export const UNTRACKED_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const untrackedSchema = z.array(z.tuple([workIdSchema, isoSchema])).max(UNTRACKED_MAX);

export async function readUntracked(): Promise<Map<string, string>> {
  const got = await browser.storage.local.get(STORAGE_KEYS.untracked);
  const r = untrackedSchema.safeParse(got[STORAGE_KEYS.untracked]);
  return new Map(r.success ? r.data : []);
}

function pruneUntracked(m: Map<string, string>): [string, string][] {
  const now = Date.now();
  return [...m.entries()].filter(([, at]) => now - isoToMs(at) < UNTRACKED_TTL_MS).slice(-UNTRACKED_MAX);
}

// ---- 查價佇列、退避與請求紀錄（§3.1、§4.1）----

export function emptyQueues(): Queues {
  return { productInfo: { ids: [], nextIndex: 0 }, dlwatcher: { ids: [], nextIndex: 0 } };
}

export async function readQueues(): Promise<Queues> {
  const got = await browser.storage.local.get(STORAGE_KEYS.queues);
  const r = queuesSchema.safeParse(got[STORAGE_KEYS.queues]);
  return r.success ? r.data : emptyQueues();
}

export async function readBackoff(): Promise<Backoff> {
  const got = await browser.storage.local.get(STORAGE_KEYS.backoff);
  const r = backoffSchema.safeParse(got[STORAGE_KEYS.backoff]);
  return r.success ? r.data : { productInfo: { failures: 0 }, dlwatcher: { failures: 0 } };
}

export async function readLastRunAt(): Promise<string | undefined> {
  const got = await browser.storage.local.get(STORAGE_KEYS.lastRunAt);
  const r = isoSchema.safeParse(got[STORAGE_KEYS.lastRunAt]);
  return r.success ? r.data : undefined;
}

export async function readDlwatcherHealth(): Promise<DlwatcherHealth> {
  const got = await browser.storage.local.get(STORAGE_KEYS.dlwatcherHealth);
  const r = dlwatcherHealthSchema.safeParse(got[STORAGE_KEYS.dlwatcherHealth]);
  return r.success ? r.data : {};
}

/** `[id, at][]` 形式的紀錄（`dlwatcherLastRequest`、`recheckAt`）。最多 2,000 筆。 */
const idTimeListSchema = z.array(z.tuple([workIdSchema, isoSchema])).max(2000);

async function readIdTimes(key: string): Promise<Map<string, string>> {
  const got = await browser.storage.local.get(key);
  const r = idTimeListSchema.safeParse(got[key]);
  return new Map(r.success ? r.data : []);
}

/** 每件作品最近一次請求 DLWatcher 的時間（§3.1：24 小時內最多一次）。 */
export const readDlwatcherLastRequest = () => readIdTimes(STORAGE_KEYS.dlwatcherLastRequest);
/** 每件作品最近一次 `recheck` 的時間（§3.2.4：10 分鐘冷卻）。 */
export const readRecheckAt = () => readIdTimes(STORAGE_KEYS.recheckAt);

/** 只留 `ttlMs` 以內的紀錄（最多 2,000 筆，留最新的）。 */
function pruneIdTimes(m: Map<string, string>, ttlMs: number): [string, string][] {
  const now = Date.now();
  return [...m.entries()].filter(([, at]) => now - isoToMs(at) < ttlMs).slice(-2000);
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
  dailyAutoAdd?: DailyAutoAdd;
  lastCart?: LastCart;
  untracked?: Map<string, string>;
  queues?: Queues;
  backoff?: Backoff;
  lastRunAt?: string;
  dlwatcherHealth?: DlwatcherHealth;
  dlwatcherLastRequest?: Map<string, string>;
  recheckAt?: Map<string, string>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const RECHECK_COOLDOWN_MS = 10 * 60 * 1000;

/** 一次 set 寫入多個 key（§4.2 一批一次寫入）。Map 存成陣列。 */
export async function writeStore(patch: StorePatch): Promise<void> {
  const out: Record<string, unknown> = {};
  if (patch.settings) out[STORAGE_KEYS.settings] = patch.settings;
  if (patch.items) out[STORAGE_KEYS.items] = [...patch.items.values()];
  if (patch.snapshots) out[STORAGE_KEYS.snapshots] = [...patch.snapshots.values()];
  if (patch.dailyAutoAdd) out[STORAGE_KEYS.dailyAutoAdd] = patch.dailyAutoAdd;
  if (patch.lastCart) out[STORAGE_KEYS.lastCart] = patch.lastCart;
  if (patch.untracked) out[STORAGE_KEYS.untracked] = pruneUntracked(patch.untracked);
  if (patch.queues) out[STORAGE_KEYS.queues] = patch.queues;
  if (patch.backoff) out[STORAGE_KEYS.backoff] = patch.backoff;
  if (patch.lastRunAt) out[STORAGE_KEYS.lastRunAt] = patch.lastRunAt;
  if (patch.dlwatcherHealth) out[STORAGE_KEYS.dlwatcherHealth] = patch.dlwatcherHealth;
  if (patch.dlwatcherLastRequest) out[STORAGE_KEYS.dlwatcherLastRequest] = pruneIdTimes(patch.dlwatcherLastRequest, DAY_MS);
  if (patch.recheckAt) out[STORAGE_KEYS.recheckAt] = pruneIdTimes(patch.recheckAt, RECHECK_COOLDOWN_MS);
  if (Object.keys(out).length > 0) await browser.storage.local.set(out);
}

// ---- storage.local 存取層級（§4.2）----

/** `storage.session` 的 key（session 預設只對受信任的環境開放）。 */
export const SESSION_KEYS = {
  storageLock: 'storageLock',
  seenDocuments: 'seenDocuments',
} as const;

const storageLockSchema = z.object({ ok: z.boolean(), at: isoSchema }).strict();
export type StorageLockState = z.infer<typeof storageLockSchema>;

/**
 * content script 不能直接讀寫 storage.local（§4.2）。service worker 每次啟動、onInstalled、onStartup 都呼叫。
 * 失敗時不丟例外：記在 storage.session 的 storageLock 並輸出錯誤，popup 顯示警告。
 */
export async function lockStorageToTrustedContexts(): Promise<boolean> {
  let ok = true;
  try {
    await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch (e) {
    ok = false;
    console.error('[DL_Assistant] storage.local.setAccessLevel 失敗，content script 可能讀得到 storage.local（§4.2）', e);
  }
  try {
    await browser.storage.session.set({ [SESSION_KEYS.storageLock]: { ok, at: nowIso() } satisfies StorageLockState });
  } catch {
    // 記錄失敗不影響鎖定結果
  }
  return ok;
}

export async function readStorageLock(): Promise<StorageLockState | undefined> {
  const got = await browser.storage.session.get(SESSION_KEYS.storageLock);
  const r = storageLockSchema.safeParse(got[SESSION_KEYS.storageLock]);
  return r.success ? r.data : undefined;
}
