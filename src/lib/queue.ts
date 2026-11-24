// §4.1 查價佇列、請求間隔與退避（background 專用）。
// service worker 閒置 30 秒就會被終止：佇列、進度、下一次可以送請求的時間、退避狀態都存在 storage.local，
// 每處理完一件（一批）就寫回。每次喚醒最多處理 60 秒，還有剩就設 drain alarm 接著做。
// 處理中每一步都把 drain alarm 往後推 30 秒：service worker 在中途被終止時，alarm 會把它叫醒接著做。
import { browser } from 'wxt/browser';
import { isoToMs, msToIso, nowIso } from './dates';
import { isDlwatcherActive } from './history';
import {
  QUEUE_MAX_IDS,
  type BackoffEntry,
  type QueueSource,
  type Queues,
  type RecentNotification,
  type Settings,
  type SourceQueue,
} from './models';
import { DLWATCHER_PAUSED_NOTICE, newNotificationId, showNotification, toRecent } from './notify';
import { checkDlwatcherItem, checkProductBatch, type DlwatcherOutcome, type IdOutcome, type ProductBatchResult } from './price-check';
import {
  readBackoff,
  readDlwatcherHealth,
  readDlwatcherLastRequest,
  readItems,
  readLastRunAt,
  readNotified,
  readQueues,
  readRecentNotifications,
  readSettings,
  pruneNotified,
  writeQueue,
  writeStore,
} from './storage';

export const ALARM_CHECK = 'check';
export const ALARM_DRAIN = 'drain';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const DEFAULT_TIMING = {
  /** §3.1：商品 API 請求之間至少 1 秒。 */
  productIntervalMs: 1000,
  /** §3.1：DLWatcher 請求之間至少 2 秒。 */
  dlwatcherIntervalMs: 2000,
  /** §4.1：每次喚醒最多處理 60 秒。 */
  runBudgetMs: 60_000,
  /** 下一個請求在這個時間內就在原地等，不設 alarm。 */
  maxInlineWaitMs: 3000,
  /** §3.1：429／5xx 的指數退避：依次 1 分、2 分、4 分後重試，三次重試都失敗（連續第 4 次）就暫停 6 小時。 */
  backoffMs: [MIN, 2 * MIN, 4 * MIN] as readonly number[],
  pauseMs: 6 * HOUR,
  /** 連不上（離線、逾時、DNS、轉址）：1 分鐘後重試，連續失敗時每次加倍，最長 1 小時。不會暫停來源（§3.1）。 */
  networkRetryMs: MIN,
  networkRetryMaxMs: HOUR,
  /** 處理中發生非預期的例外：這麼久之後才再試（避免 drain alarm 每 30 秒重送同一個請求）。 */
  errorRetryMs: 5 * MIN,
  /** chrome.alarms 的最短間隔。 */
  minAlarmMs: 30_000,
};
let timing = { ...DEFAULT_TIMING };

/** 測試用：調整時間參數；不帶參數就還原。 */
export function __setTimingForTest(p: Partial<typeof DEFAULT_TIMING> = {}): void {
  timing = { ...DEFAULT_TIMING, ...p };
}

const PRODUCT_BATCH = 100;
/**
 * §3.1：DLWatcher 每件作品 23 小時內最多請求一次。對方的快取是 24 小時，但定時查價剛好每 24 小時（或 6 小時的倍數）一輪，
 * 一件作品在一輪裡可能晚幾十分鐘才輪到：用 24 小時的話下一輪會差一點點不到而被跳過，變成 30～48 小時才更新一次（M3 審查）。
 */
export const DLWATCHER_MIN_INTERVAL_MS = 23 * HOUR;
/** §3.6：DLWatcher 連續 7 天全部失敗就自動暫停。 */
export const DLWATCHER_AUTO_PAUSE_MS = 7 * DAY;
/** §3.6：兩次失敗相隔超過這個時間（中間沒有請求，例如瀏覽器關著），連續失敗重新起算。 */
export const DLWATCHER_STREAK_GAP_MS = 2 * DAY;

const SOURCES: readonly QueueSource[] = ['productInfo', 'dlwatcher'];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hasWork = (q: SourceQueue) => q.nextIndex < q.ids.length;

// ---- 等待某件作品查完價（track、recheck 的回覆用；只在記憶體裡）----

const waiters = new Map<string, ((o: IdOutcome) => void)[]>();

function addWaiter(id: string): Promise<IdOutcome> {
  return new Promise((resolve) => {
    const list = waiters.get(id);
    if (list) list.push(resolve);
    else waiters.set(id, [resolve]);
  });
}

function settle(ids: readonly string[], outcome: (id: string) => IdOutcome): void {
  for (const id of ids) {
    const list = waiters.get(id);
    if (!list) continue;
    waiters.delete(id);
    const o = outcome(id);
    for (const fn of list) fn(o);
  }
}

/** 還在等的回覆：商品 API 在退避中就回 backoff，否則回 queued（作品留在佇列，稍後自動查價）。 */
function settleWaiting(b: BackoffEntry | null): void {
  const backingOff = b ? b.pausedUntil !== undefined || b.failures > 0 || b.networkFailures !== undefined : false;
  settle([...waiters.keys()], () => ({ status: 'failed', reason: backingOff ? 'backoff' : 'queued' }));
}

// ---- 佇列操作（全部在 writeQueue 裡，和其他寫入依序執行，§4.2）----

/** 加進佇列（去掉重複）。`front`：排到最前面（使用者剛加入、按了重新查價）。已處理的部分順便清掉。 */
export async function enqueue(source: QueueSource, ids: readonly string[], opts: { front?: boolean } = {}): Promise<void> {
  if (ids.length === 0) return;
  await writeQueue(async () => {
    const queues = await readQueues();
    const q = queues[source];
    const pending = q.ids.slice(q.nextIndex);
    const add = [...new Set(ids)];
    let next: string[];
    if (opts.front) {
      const addSet = new Set(add);
      next = [...add, ...pending.filter((id) => !addSet.has(id))];
    } else {
      const have = new Set(pending);
      next = [...pending, ...add.filter((id) => !have.has(id))];
    }
    queues[source] = { ...q, ids: next.slice(0, QUEUE_MAX_IDS), nextIndex: 0 };
    await writeStore({ queues });
  });
}

/** 處理完 `done` 這幾件：佇列沒被改過就把 nextIndex 往後移，被改過（中途有人加入）就把它們從剩下的裡面拿掉。 */
function advanceQueue(q: SourceQueue, done: readonly string[]): SourceQueue {
  const head = q.ids.slice(q.nextIndex, q.nextIndex + done.length);
  let next: SourceQueue;
  if (head.length === done.length && head.every((id, i) => id === done[i])) {
    next = { ...q, nextIndex: q.nextIndex + done.length };
  } else {
    const doneSet = new Set(done);
    next = { ...q, ids: q.ids.slice(q.nextIndex).filter((id) => !doneSet.has(id)), nextIndex: 0 };
  }
  return hasWork(next) ? next : { ...next, ids: [], nextIndex: 0 };
}

async function updateQueues(fn: (queues: Queues) => void): Promise<void> {
  await writeQueue(async () => {
    const queues = await readQueues();
    fn(queues);
    await writeStore({ queues });
  });
}

const setNextAt = (source: QueueSource, ms: number) =>
  updateQueues((queues) => {
    queues[source] = { ...queues[source], nextAt: msToIso(ms) };
  });

/** 這個來源下一次可以送請求的時間：請求間隔與退避暫停取晚的。 */
function readyAt(q: SourceQueue, b: BackoffEntry): number {
  return Math.max(q.nextAt ? isoToMs(q.nextAt) : 0, b.pausedUntil ? isoToMs(b.pausedUntil) : 0);
}

/** §3.1：429／5xx（或整批被 4xx 拒絕）。依次退避 1、2、4 分鐘；三次重試都失敗就暫停這個來源 6 小時。 */
async function recordRetryFailure(source: QueueSource): Promise<void> {
  await writeQueue(async () => {
    const [queues, backoff] = await Promise.all([readQueues(), readBackoff()]);
    const now = Date.now();
    const failures = backoff[source].failures + 1;
    if (failures > timing.backoffMs.length) {
      backoff[source] = { failures: 0, pausedUntil: msToIso(now + timing.pauseMs) };
    } else {
      // 對方有回應：連不上的計數歸零
      backoff[source] = { failures };
      queues[source] = { ...queues[source], nextAt: msToIso(now + timing.backoffMs[failures - 1]!) };
    }
    await writeStore({ queues, backoff });
  });
}

/** 連不上：同一批稍後重試，間隔隨連續次數加倍（1 分 → 1 小時）。回傳連續次數。 */
async function recordNetworkFailure(source: QueueSource): Promise<void> {
  await writeQueue(async () => {
    const [queues, backoff] = await Promise.all([readQueues(), readBackoff()]);
    const n = Math.min((backoff[source].networkFailures ?? 0) + 1, 10_000);
    const delay = Math.min(timing.networkRetryMs * 2 ** Math.min(n - 1, 20), timing.networkRetryMaxMs);
    backoff[source] = { ...backoff[source], networkFailures: n };
    queues[source] = { ...queues[source], nextAt: msToIso(Date.now() + delay) };
    await writeStore({ queues, backoff });
  });
}

/**
 * 處理完一步，推進佇列。`ok`：成功，清掉這個來源的退避狀態；`responded`：對方有回應但這幾件不成功
 * （查不到、不通過檢查），只清掉「連不上」的計數；`skipped`：沒有送出請求（或處理時出錯），退避狀態不動。
 */
async function finishStep(source: QueueSource, done: readonly string[], how: 'ok' | 'responded' | 'skipped'): Promise<void> {
  await writeQueue(async () => {
    const [queues, backoff] = await Promise.all([readQueues(), readBackoff()]);
    queues[source] = advanceQueue(queues[source], done);
    const b = backoff[source];
    let next: BackoffEntry = b;
    if (how === 'ok' && (b.failures > 0 || b.pausedUntil !== undefined || b.networkFailures !== undefined)) next = { failures: 0 };
    else if (how === 'responded' && b.networkFailures !== undefined)
      next = { failures: b.failures, ...(b.pausedUntil ? { pausedUntil: b.pausedUntil } : {}) };
    if (next !== b) backoff[source] = next;
    await writeStore({ queues, ...(next !== b ? { backoff } : {}) });
  });
}

// ---- 處理一步 ----

async function stepProduct(): Promise<void> {
  const q = (await readQueues()).productInfo;
  const slice = q.ids.slice(q.nextIndex, q.nextIndex + PRODUCT_BATCH);
  const items = await readItems();
  // §4.1：暫停追蹤的作品不查價；已移除的略過。
  const batch = slice.filter((id) => items.get(id)?.paused === false);
  const batchSet = new Set(batch);
  settle(
    slice.filter((id) => !batchSet.has(id)),
    () => ({ status: 'failed', reason: 'notTracked' }),
  );
  if (batch.length === 0) {
    await finishStep('productInfo', slice, 'skipped');
    return;
  }
  const beforeRequest = async () => {
    await setNextAt('productInfo', Date.now() + timing.productIntervalMs);
  };
  await beforeRequest();
  let r: ProductBatchResult | { kind: 'error' };
  try {
    r = await checkProductBatch(batch, async () => {
      await sleep(timing.productIntervalMs);
      await beforeRequest();
    });
  } catch (e) {
    // 寫入 storage／IndexedDB 失敗等：這一批這一輪跳過，不要每 30 秒重送（M3 審查）
    console.error('[DL_Assistant] 查價處理失敗，這一批這一輪跳過', e);
    r = { kind: 'error' };
  }
  switch (r.kind) {
    case 'done':
      await finishStep('productInfo', slice, 'ok');
      settle(slice, (id) => r.outcomes.get(id) ?? { status: 'failed', reason: 'notTracked' });
      return;
    case 'retry':
      await recordRetryFailure('productInfo');
      settle(batch, () => ({ status: 'failed', reason: r.reason }));
      return;
    case 'network':
      await recordNetworkFailure('productInfo');
      settle(batch, () => ({ status: 'failed', reason: 'network' }));
      return;
    case 'failed':
      await finishStep('productInfo', slice, 'responded');
      settle(batch, () => ({ status: 'failed', reason: r.reason }));
      return;
    case 'error':
      await finishStep('productInfo', slice, 'skipped');
      settle(batch, () => ({ status: 'failed', reason: 'failed' }));
      return;
  }
}

async function stepDlwatcher(): Promise<void> {
  const q = (await readQueues()).dlwatcher;
  const id = q.ids[q.nextIndex];
  if (id === undefined) return;
  const [items, lastRequest] = await Promise.all([readItems(), readDlwatcherLastRequest()]);
  const last = lastRequest.get(id);
  // §3.1：最近請求過的不再請求（瀏覽器重開也一樣）
  if (items.get(id)?.paused !== false || (last && Date.now() - isoToMs(last) < DLWATCHER_MIN_INTERVAL_MS)) {
    await finishStep('dlwatcher', [id], 'skipped');
    return;
  }
  await setNextAt('dlwatcher', Date.now() + timing.dlwatcherIntervalMs);
  // 請求時間記送出的時候（不是收到回應的時候），下一輪才不會差幾秒被跳過。
  const sentAt = nowIso();
  let r: DlwatcherOutcome | { kind: 'error' };
  try {
    r = await checkDlwatcherItem(id);
  } catch (e) {
    // IndexedDB 寫入失敗等：當作請求過，23 小時內不再請求（M3 審查：否則每 30 秒重送一次）
    console.error('[DL_Assistant] DLWatcher 資料處理失敗', e);
    r = { kind: 'error' };
  }
  if (r.kind === 'rejected' && r.reason === 'notTracked') {
    await finishStep('dlwatcher', [id], 'skipped'); // 查詢途中被移除：不算 DLWatcher 失敗
    return;
  }
  if (r.kind === 'retry') await recordRetryFailure('dlwatcher');
  if (r.kind === 'network') await recordNetworkFailure('dlwatcher');
  await recordDlwatcherResult(id, r, sentAt);
}

/**
 * 記下 DLWatcher 的請求時間、推進佇列、更新 §3.6 的健康狀態。
 * - 成功：清掉連續失敗。
 * - 失敗（驗證失敗、不通過檢查、其他 4xx、429／5xx）：記下開始失敗的時間；和上一次失敗相隔超過 2 天就重新起算
 *   （中間沒有請求，不能算「連續」）。持續 7 天就自動暫停 DLWatcher，之後要使用者送 resumeDlwatcher 才恢復。
 * - 連不上：商品 API 同時也連不上（多半是自己離線）時不算；只有 DLWatcher 連不上才算失敗，網域失效或整站轉址時也會自動暫停。
 * - 404、處理時出錯：不算成功也不算失敗（冷門或太新的作品本來就查不到）。
 */
async function recordDlwatcherResult(id: string, r: DlwatcherOutcome | { kind: 'error' }, sentAt: string): Promise<void> {
  const advance = r.kind !== 'retry' && r.kind !== 'network';
  if (advance) await finishStep('dlwatcher', [id], r.kind === 'saved' ? 'ok' : r.kind === 'error' ? 'skipped' : 'responded');
  const pausedNotice = await writeQueue(async (): Promise<string | undefined> => {
    const [lastRequest, health, settings, queues, backoff] = await Promise.all([
      readDlwatcherLastRequest(),
      readDlwatcherHealth(),
      readSettings(),
      readQueues(),
      readBackoff(),
    ]);
    const now = nowIso();
    // 對方有回應（含 404、不通過檢查）或處理時出錯才記請求時間；429／5xx、連不上之後要能重試。
    if (advance) {
      lastRequest.delete(id);
      lastRequest.set(id, sentAt);
    }
    const failed =
      r.kind === 'rejected' || r.kind === 'retry' || (r.kind === 'network' && backoff.productInfo.networkFailures === undefined);
    let nextHealth = health;
    let nextSettings: Settings | undefined;
    let recent: RecentNotification[] | undefined;
    let noticeId: string | undefined;
    if (r.kind === 'saved') {
      if (health.allFailingSince || health.lastFailureAt) nextHealth = {};
    } else if (failed) {
      const gap = health.lastFailureAt ? Date.now() - isoToMs(health.lastFailureAt) : Infinity;
      const since = health.allFailingSince && gap <= DLWATCHER_STREAK_GAP_MS ? health.allFailingSince : now;
      nextHealth = { allFailingSince: since, lastFailureAt: now };
      if (Date.now() - isoToMs(since) >= DLWATCHER_AUTO_PAUSE_MS && settings.dlwatcherAutoPausedAt === undefined) {
        nextSettings = { ...settings, dlwatcherAutoPausedAt: now };
        queues.dlwatcher = { ids: [], nextIndex: 0, ...(queues.dlwatcher.nextAt ? { nextAt: queues.dlwatcher.nextAt } : {}) };
        console.warn('[DL_Assistant] DLWatcher 連續 7 天都失敗，已自動暫停（§3.6）');
        // §3.6：系統通知（和設定同一次寫入，寫完才送，§4.2）
        noticeId = newNotificationId();
        recent = [toRecent(noticeId, DLWATCHER_PAUSED_NOTICE, [], now), ...(await readRecentNotifications())];
      }
    }
    await writeStore({
      ...(advance ? { dlwatcherLastRequest: lastRequest } : {}),
      ...(nextHealth !== health ? { dlwatcherHealth: nextHealth } : {}),
      ...(nextSettings ? { settings: nextSettings, queues } : {}),
      ...(recent ? { recentNotifications: recent } : {}),
    });
    return noticeId;
  });
  if (pausedNotice) await showNotification(pausedNotice, DLWATCHER_PAUSED_NOTICE);
}

// ---- drain：依序處理兩條佇列 ----

async function scheduleDrain(atMs: number): Promise<void> {
  await browser.alarms.create(ALARM_DRAIN, { when: Math.max(atMs, Date.now() + timing.minAlarmMs) });
}

/** `deadline`：這次喚醒的處理期限（§4.1：60 秒）。跑完又被叫到（rerun）時沿用同一個期限。 */
async function runDrain(deadline: number): Promise<void> {
  for (;;) {
    const [queues, backoff, settings] = await Promise.all([readQueues(), readBackoff(), readSettings()]);
    if (!isDlwatcherActive(settings) && queues.dlwatcher.ids.length > 0) {
      await updateQueues((qs) => {
        qs.dlwatcher = { ...qs.dlwatcher, ids: [], nextIndex: 0 };
      });
      continue;
    }
    // 兩條佇列各自計算可以送請求的時間，一條在退避時不會卡住另一條（§4.1）。
    // 商品 API 在等退避或間隔很久：等著回覆的 track／recheck 先回「已排入佇列」，不用等 DLWatcher 跑完。
    if (readyAt(queues.productInfo, backoff.productInfo) > Date.now() + timing.maxInlineWaitMs) settleWaiting(backoff.productInfo);
    let pick: { source: QueueSource; at: number } | null = null;
    for (const source of SOURCES) {
      if (!hasWork(queues[source])) continue;
      const at = readyAt(queues[source], backoff[source]);
      if (!pick || at < pick.at) pick = { source, at };
    }
    if (!pick) {
      await browser.alarms.clear(ALARM_DRAIN);
      return;
    }
    const now = Date.now();
    const wait = pick.at - now;
    if (now >= deadline || (wait > 0 && (wait > timing.maxInlineWaitMs || now + wait >= deadline))) {
      await scheduleDrain(Math.max(pick.at, now));
      return;
    }
    // service worker 在這一步被終止時，30 秒後由 alarm 叫醒接著做。
    await scheduleDrain(now);
    if (wait > 0) await sleep(wait);
    if (pick.source === 'productInfo') await stepProduct();
    else await stepDlwatcher();
  }
}

let running: Promise<void> | null = null;
let rerun = false;

/** 開始（或繼續）處理佇列。同時只有一個在跑；跑的途中又被叫到，跑完會再檢查一次。 */
export function kick(): Promise<void> {
  if (running) {
    rerun = true;
    // 正在跑的一步可能還要一陣子（等回應）：drain alarm 剛觸發過的話要再設一次，
    // 否則這一步之中 service worker 被終止，就沒有 alarm 叫醒它了。
    void scheduleDrain(Date.now()).catch(() => undefined);
    return running;
  }
  running = (async () => {
    const deadline = Date.now() + timing.runBudgetMs;
    try {
      do {
        rerun = false;
        await runDrain(deadline);
      } while (rerun);
    } catch (e) {
      // storage 讀寫失敗等：不要讓 30 秒後的 drain alarm 馬上重來，晚一點再試
      console.error('[DL_Assistant] 查價佇列處理失敗', e);
      await scheduleDrain(Date.now() + timing.errorRetryMs).catch(() => undefined);
    } finally {
      running = null;
      // 這次沒處理到的（等退避、等下一次喚醒）：回覆「已排入佇列」
      const b = await readBackoff().catch(() => null);
      if (!running) settleWaiting(b?.productInfo ?? null);
    }
  })();
  return running;
}

/** 測試用：等目前的處理結束。 */
export async function whenIdle(): Promise<void> {
  while (running) await running;
}

/**
 * 把作品排到佇列最前面並開始處理（使用者加入追蹤、重新查價）。
 * `awaitProduct`：等商品 API 查完這幾件才回傳每件的結果；排不到（退避中、時間用完）時是 queued／backoff。
 */
export async function requestChecks(
  ids: readonly string[],
  opts: { awaitProduct?: boolean; dlwatcher?: boolean } = {},
): Promise<Map<string, IdOutcome> | undefined> {
  await enqueue('productInfo', ids, { front: true });
  if (opts.dlwatcher) await enqueueDlwatcher(ids, { front: true });
  // 先登記再 kick（中間沒有 await）：正在跑的 drain 一定會再檢查一次佇列。
  const pending = opts.awaitProduct ? ids.map((id) => addWaiter(id)) : [];
  void kick();
  if (!opts.awaitProduct) return undefined;
  const outs = await Promise.all(pending);
  return new Map(ids.map((id, i) => [id, outs[i]!]));
}

/** DLWatcher 使用中時，把 23 小時內沒請求過的作品加進 dlwatcher 佇列。 */
export async function enqueueDlwatcher(ids: readonly string[], opts: { front?: boolean } = {}): Promise<void> {
  const [settings, lastRequest] = await Promise.all([readSettings(), readDlwatcherLastRequest()]);
  if (!isDlwatcherActive(settings)) return;
  const now = Date.now();
  const due = ids.filter((id) => {
    const last = lastRequest.get(id);
    return !last || now - isoToMs(last) >= DLWATCHER_MIN_INTERVAL_MS;
  });
  await enqueue('dlwatcher', due, opts);
}

// ---- 排程（§4.1）----

/** 一輪查價：所有沒有暫停的追蹤作品排進商品 API 佇列；DLWatcher 一天最多更新一次。 */
export async function startRun(): Promise<void> {
  const items = await readItems();
  const ids = [...items.values()].filter((i) => !i.paused).map((i) => i.id);
  // §6.1：notified 超過 180 天的紀錄在每次排程時刪除。
  await writeQueue(async () => {
    const notified = await readNotified();
    const pruned = pruneNotified(notified, Date.now());
    await writeStore({ lastRunAt: nowIso(), ...(pruned.size !== notified.size ? { notified: pruned } : {}) });
  });
  await enqueue('productInfo', ids);
  await enqueueDlwatcher(ids);
  void kick();
}

/** 依設定的週期建立（或重建）定時查價的 alarm。 */
export async function rescheduleCheck(settings?: Settings): Promise<void> {
  const s = settings ?? (await readSettings());
  const period = s.checkIntervalHours * 60;
  await browser.alarms.create(ALARM_CHECK, { periodInMinutes: period, delayInMinutes: period });
}

/**
 * §4.1：onInstalled、onStartup 與 service worker 每次啟動都呼叫。alarm 不在（或週期不對）就重建；
 * 距離上次查價超過一個週期就立刻排一輪；佇列還有剩（上次被終止）就接著做。
 */
export async function ensureSchedule(): Promise<void> {
  const settings = await readSettings();
  const period = settings.checkIntervalHours * 60;
  const alarm = await browser.alarms.get(ALARM_CHECK);
  if (!alarm || alarm.periodInMinutes !== period) await rescheduleCheck(settings);
  const last = await readLastRunAt();
  if (!last || Date.now() - isoToMs(last) >= period * MIN) {
    await startRun();
    return;
  }
  const queues = await readQueues();
  if (hasWork(queues.productInfo) || hasWork(queues.dlwatcher)) void kick();
}

export async function handleAlarm(name: string): Promise<void> {
  if (name === ALARM_CHECK) await startRun();
  else if (name === ALARM_DRAIN) await kick();
}
