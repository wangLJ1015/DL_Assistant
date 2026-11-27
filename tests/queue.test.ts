// §4.1 查價佇列與退避、§3.1 請求節制、§3.6 DLWatcher 自動暫停（M3）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { defaultSettings, type TrackedItem } from '../src/lib/models';

const PRODUCT = readFileSync(resolve(import.meta.dirname, 'fixtures/product-info-RJ01014447-RJ99999999.json'), 'utf8');
const DLW = readFileSync(resolve(import.meta.dirname, 'fixtures/dlwatcher-RJ01014447.json'), 'utf8');

const apiGet = vi.fn();
vi.mock('../src/lib/api/endpoints', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));

const queue = await import('../src/lib/queue');
const { __setTimingForTest, ALARM_CHECK, ALARM_DRAIN, enqueue, ensureSchedule, handleAlarm, kick, whenIdle } = queue;
const tracking = await import('../src/lib/tracking');
const storage = await import('../src/lib/storage');
const {
  readBackoff,
  readDlwatcherHealth,
  readDlwatcherLastRequest,
  readItems,
  readLastRunAt,
  readQueues,
  readSettings,
  readSnapshots,
  writeStore,
} = storage;
const { readHistory } = await import('../src/lib/db');

const MIN = 60_000;
const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `RJ${String(from + i).padStart(8, '0')}`);
const item = (id: string, patch: Partial<TrackedItem> = {}): TrackedItem => ({
  id,
  site: 'maniax',
  title: '',
  imageUrl: '',
  addedAt: '2026-11-23T00:00:00.000Z',
  source: 'manual',
  autoAdded: false,
  paused: false,
  ...patch,
});
const seed = (list: string[], patch: Partial<TrackedItem> = {}) => writeStore({ items: new Map(list.map((id) => [id, item(id, patch)])) });

/** 商品 API：每個請求的編號都回傳「存在」（用 fixture 的 RJ01014447 改編號）。 */
function productFor(reqIds: readonly string[]): string {
  const base = (JSON.parse(PRODUCT) as Record<string, unknown>).RJ01014447;
  return JSON.stringify(Object.fromEntries(reqIds.map((id) => [id, base])));
}
const dlwFor = (id: string) => DLW.replace('"productId": "RJ01014447"', `"productId": "${id}"`);
const calls = (key: string) => apiGet.mock.calls.filter(([k]) => k === key);

beforeEach(() => {
  fakeBrowser.reset();
  __setTimingForTest({ productIntervalMs: 0, dlwatcherIntervalMs: 0 });
  apiGet.mockReset();
  apiGet.mockImplementation(async (key: string, p: { ids?: string[]; id?: string }) =>
    key === 'productInfo' ? { ok: true, status: 200, text: productFor(p.ids!) } : { ok: true, status: 200, text: dlwFor(p.id!) },
  );
});
afterEach(async () => {
  await whenIdle();
  __setTimingForTest();
});

describe('§4.1 queues', () => {
  it('a full run checks every unpaused work in batches of 100 and fetches DLWatcher once per work', async () => {
    const all = ids(150);
    await seed(all);
    const items = await readItems();
    items.set('RJ99999998', item('RJ99999998', { paused: true }));
    await writeStore({ items });
    await queue.startRun();
    await whenIdle();
    expect(calls('productInfo').map(([, p]) => (p as { ids: string[] }).ids.length)).toEqual([100, 50]);
    expect(calls('dlwatcher')).toHaveLength(150);
    expect((await readSnapshots()).size).toBe(150);
    expect((await readSnapshots()).has('RJ99999998')).toBe(false);
    expect(await readHistory('RJ00000150')).toBeDefined();
    expect(await readQueues()).toMatchObject({ productInfo: { ids: [], nextIndex: 0 }, dlwatcher: { ids: [], nextIndex: 0 } });
    expect(await readLastRunAt()).toBeDefined();
    expect(await fakeBrowser.alarms.get(ALARM_DRAIN)).toBeUndefined();
  });

  it('DLWatcher is requested at most once per work in 23 hours, also across a new run (§3.1)', async () => {
    await seed(ids(3));
    await queue.startRun();
    await whenIdle();
    await queue.startRun();
    await whenIdle();
    expect(calls('dlwatcher')).toHaveLength(3);
    expect(calls('productInfo')).toHaveLength(2);
    const last = await readDlwatcherLastRequest();
    // 22 小時前：還不行；23 小時又 1 分鐘前：可以（下一輪 24 小時後的查價不會差幾分鐘被跳過，M3 審查）
    last.set('RJ00000001', new Date(Date.now() - 22 * 60 * MIN).toISOString());
    last.set('RJ00000002', new Date(Date.now() - 23 * 60 * MIN - MIN).toISOString());
    await writeStore({ dlwatcherLastRequest: last });
    await queue.startRun();
    await whenIdle();
    expect(
      calls('dlwatcher')
        .slice(3)
        .map(([, p]) => (p as { id: string }).id),
    ).toEqual(['RJ00000002']);
  });

  it('records the DLWatcher request time when it was sent, not when the answer came back', async () => {
    await seed(ids(1));
    let sentAt = 0;
    apiGet.mockImplementation(async (key: string, p: { ids?: string[]; id?: string }) => {
      if (key === 'productInfo') return { ok: true, status: 200, text: productFor(p.ids!) };
      sentAt = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true, status: 200, text: dlwFor(p.id!) };
    });
    await queue.startRun();
    await whenIdle();
    const at = Date.parse((await readDlwatcherLastRequest()).get('RJ00000001')!);
    expect(at).toBeLessThanOrEqual(sentAt);
  });

  it('resumes from the stored progress after the service worker stops mid-run (M3 completion)', async () => {
    // 每次喚醒只給 1 毫秒：處理一步就停下來、設 drain alarm（模擬中途被終止，記憶體裡的狀態不重要）
    __setTimingForTest({ productIntervalMs: 0, dlwatcherIntervalMs: 0, runBudgetMs: 1 });
    await seed(ids(5));
    await queue.startRun();
    await whenIdle();
    // 1 毫秒的期限在測試整體負載高時，可能讀完佇列就已經過了、連第一步都沒做（M4 時偶爾失敗）：
    // 用 drain alarm 叫醒到商品 API 那一步做完為止。
    for (let i = 0; i < 10 && calls('productInfo').length === 0; i++) {
      await handleAlarm(ALARM_DRAIN);
      await whenIdle();
    }
    const after1 = await readQueues();
    expect(calls('productInfo')).toHaveLength(1);
    expect(after1.dlwatcher.ids.length - after1.dlwatcher.nextIndex).toBeGreaterThan(0);
    const alarm = await fakeBrowser.alarms.get(ALARM_DRAIN);
    expect(alarm).toBeDefined();
    // drain alarm 叫醒：從 nextIndex 接著做，不重做已完成的
    for (let i = 0; i < 10 && (await readQueues()).dlwatcher.ids.length > 0; i++) {
      await handleAlarm(ALARM_DRAIN);
      await whenIdle();
    }
    expect(calls('productInfo')).toHaveLength(1);
    expect(calls('dlwatcher').map(([, p]) => (p as { id: string }).id)).toEqual(ids(5));
  });

  it('service worker start continues a queue left over from before (§4.1)', async () => {
    await seed(ids(2));
    await writeStore({
      lastRunAt: new Date().toISOString(),
      queues: { productInfo: { ids: ids(2), nextIndex: 1 }, dlwatcher: { ids: [], nextIndex: 0 } },
    });
    await ensureSchedule();
    await vi.waitFor(() => expect(calls('productInfo')).toHaveLength(1));
    await whenIdle();
    expect(calls('productInfo')[0]![1]).toEqual({ ids: ['RJ00000002'] });
  });

  it('ensureSchedule creates the check alarm and runs when the last run is older than the interval', async () => {
    await seed(ids(1));
    await ensureSchedule();
    expect(await fakeBrowser.alarms.get(ALARM_CHECK)).toMatchObject({ periodInMinutes: 360 });
    await vi.waitFor(() => expect(calls('productInfo')).toHaveLength(1));
    await whenIdle();
    // 剛查過：不再查
    await ensureSchedule();
    await whenIdle();
    expect(calls('productInfo')).toHaveLength(1);
    // 改查價週期：alarm 重建
    await tracking.updateSettings({ checkIntervalHours: 2 });
    expect(await fakeBrowser.alarms.get(ALARM_CHECK)).toMatchObject({ periodInMinutes: 120 });
  });

  it('front-enqueued works are checked first', async () => {
    await seed(ids(3));
    await enqueue('productInfo', ['RJ00000001', 'RJ00000002']);
    await enqueue('productInfo', ['RJ00000003', 'RJ00000002'], { front: true });
    expect((await readQueues()).productInfo.ids).toEqual(['RJ00000003', 'RJ00000002', 'RJ00000001']);
  });
});

/** 清掉這個來源的 nextAt（模擬時間過去），再處理一次。 */
async function clearNextAtAndKick(source: 'productInfo' | 'dlwatcher' = 'productInfo') {
  const qs = await readQueues();
  const { nextAt: _, ...rest } = qs[source];
  await writeStore({ queues: { ...qs, [source]: rest } });
  const t = Date.now();
  await kick();
  return t;
}
const waitOf = async (t: number, source: 'productInfo' | 'dlwatcher' = 'productInfo') =>
  Date.parse((await readQueues())[source].nextAt!) - t;

describe('§3.1 backoff', () => {
  it('429／5xx retry after 1, 2 and 4 minutes, then pause the source for 6 hours; DLWatcher keeps going', async () => {
    await seed(ids(2));
    apiGet.mockImplementation(async (key: string, p: { id?: string }) =>
      key === 'productInfo' ? { ok: false, kind: 'http', status: 503 } : { ok: true, status: 200, text: dlwFor(p.id!) },
    );
    const t0 = Date.now();
    await queue.startRun();
    await whenIdle();
    expect((await readBackoff()).productInfo).toEqual({ failures: 1 });
    expect(await waitOf(t0)).toBeGreaterThanOrEqual(MIN);
    // 一個來源在退避時不會卡住另一個（§4.1）
    expect(calls('dlwatcher')).toHaveLength(2);
    let t = await clearNextAtAndKick();
    expect((await readBackoff()).productInfo).toEqual({ failures: 2 });
    expect(await waitOf(t)).toBeGreaterThanOrEqual(2 * MIN);
    t = await clearNextAtAndKick();
    expect((await readBackoff()).productInfo).toEqual({ failures: 3 });
    expect(await waitOf(t)).toBeGreaterThanOrEqual(4 * MIN);
    // 三次重試都失敗：暫停 6 小時
    await clearNextAtAndKick();
    const b = await readBackoff();
    expect(b.productInfo.failures).toBe(0);
    expect(Date.parse(b.productInfo.pausedUntil!) - Date.now()).toBeGreaterThan(5.9 * 60 * MIN);
    expect(calls('productInfo')).toHaveLength(4);
    // 暫停中：不再請求
    await clearNextAtAndKick();
    expect(calls('productInfo')).toHaveLength(4);
    expect((await readQueues()).productInfo.ids).toEqual(ids(2));
    // 成功一次就清掉退避
    await writeStore({ backoff: { productInfo: { failures: 2, networkFailures: 3 }, dlwatcher: { failures: 0 } } });
    apiGet.mockImplementation(async (_k: string, p: { ids: string[] }) => ({ ok: true, status: 200, text: productFor(p.ids) }));
    await clearNextAtAndKick();
    expect((await readBackoff()).productInfo).toEqual({ failures: 0 });
    expect((await readQueues()).productInfo.ids).toEqual([]);
  });

  it('network failures retry the same batch with a doubling delay (1 minute up to 1 hour) and never pause', async () => {
    await seed(ids(1));
    apiGet.mockImplementation(async (key: string) =>
      key === 'productInfo' ? { ok: false, kind: 'network' } : { ok: false, kind: 'http', status: 404 },
    );
    let t = Date.now();
    await queue.startRun();
    await whenIdle();
    const waits: number[] = [await waitOf(t)];
    for (let i = 0; i < 7; i++) {
      t = await clearNextAtAndKick();
      waits.push(await waitOf(t));
    }
    expect(waits.map((w) => Math.round(w / MIN))).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
    const b = (await readBackoff()).productInfo;
    expect(b).toEqual({ failures: 0, networkFailures: 8 });
    expect((await readQueues()).productInfo.ids).toEqual(ids(1));
    expect(calls('productInfo')).toHaveLength(8);
  });

  it('a recheck during backoff replies "backoff" without sending a request, and does not use up the cooldown', async () => {
    await seed(ids(1));
    await writeStore({
      backoff: { productInfo: { failures: 0, pausedUntil: new Date(Date.now() + 60 * MIN).toISOString() }, dlwatcher: { failures: 0 } },
    });
    expect(await tracking.recheck(['RJ00000001'])).toEqual({ ok: false, reason: 'backoff' });
    expect(await tracking.recheck(['RJ00000001'])).toEqual({ ok: false, reason: 'backoff' });
    expect(calls('productInfo')).toHaveLength(0);
  });

  it('splits a batch rejected with 4xx and marks only the bad id as not found (§4.1)', async () => {
    const all = ids(100);
    await seed(all);
    apiGet.mockImplementation(async (key: string, p: { ids?: string[] }) => {
      if (key !== 'productInfo') return { ok: false, kind: 'http', status: 404 };
      return p.ids!.includes('RJ00000042') ? { ok: false, kind: 'http', status: 400 } : { ok: true, status: 200, text: productFor(p.ids!) };
    });
    expect(await tracking.refreshPrices(all)).toEqual({ ok: true, updated: 99, missing: 1, invalid: 0 });
    const items = await readItems();
    expect(items.get('RJ00000042')!.notFoundCount).toBe(1);
    expect(items.get('RJ00000041')!.notFoundCount).toBeUndefined();
    expect((await readBackoff()).productInfo.failures).toBe(0);
    // 1 + 每一層 2 個（100 → 50 → 25 → 13 → 7 → 4 → 2 → 1）
    expect(calls('productInfo').length).toBeLessThanOrEqual(1 + 2 * 7);
  });

  it('a whole batch rejected with 4xx (WAF, API change) backs off instead of marking every work not found (M3 review)', async () => {
    const all = ids(100);
    await seed(all);
    apiGet.mockImplementation(async (key: string) =>
      key === 'productInfo' ? { ok: false, kind: 'http', status: 403 } : { ok: false, kind: 'http', status: 404 },
    );
    expect(await tracking.refreshPrices(all)).toEqual({ ok: false, reason: 'http403' });
    // 第一個請求＋拆一次的兩半，兩半都被拒絕就停
    expect(calls('productInfo')).toHaveLength(3);
    expect((await readBackoff()).productInfo).toEqual({ failures: 1 });
    const items = await readItems();
    expect([...items.values()].some((i) => i.notFoundCount !== undefined)).toBe(false);
    expect((await readSnapshots()).size).toBe(0);
    expect((await readQueues()).productInfo.ids).toHaveLength(100);
  });

  it('a single-work batch rejected with 4xx backs off too (a block cannot be told apart from a bad id)', async () => {
    await seed(ids(1));
    apiGet.mockImplementation(async (key: string) =>
      key === 'productInfo' ? { ok: false, kind: 'http', status: 403 } : { ok: false, kind: 'http', status: 404 },
    );
    expect(await tracking.refreshPrices(ids(1))).toEqual({ ok: false, reason: 'http403' });
    expect((await readItems()).get('RJ00000001')!.notFoundCount).toBeUndefined();
    expect((await readBackoff()).productInfo.failures).toBe(1);
  });
});

describe('unexpected errors in a step (M3 review)', () => {
  const brokenIndexedDb = async () => {
    const { __closeDbForTest } = await import('../src/lib/db');
    await __closeDbForTest();
    globalThis.indexedDB = {
      open: () => {
        throw new Error('IndexedDB is broken');
      },
    } as unknown as IDBFactory;
  };

  it('a failing IndexedDB write does not make DLWatcher get re-requested every 30 seconds', async () => {
    await seed(ids(1));
    await writeStore({ lastRunAt: new Date().toISOString() });
    await brokenIndexedDb();
    await queue.enqueue('dlwatcher', ids(1));
    for (let i = 0; i < 3; i++) {
      await handleAlarm(ALARM_DRAIN);
      await whenIdle();
    }
    expect(calls('dlwatcher')).toHaveLength(1);
    expect((await readQueues()).dlwatcher.ids).toEqual([]);
    expect((await readDlwatcherLastRequest()).has('RJ00000001')).toBe(true);
    expect(await readDlwatcherHealth()).toEqual({}); // 自己這邊的錯，不算 DLWatcher 失敗
  });

  it('a failing priceLog write skips the batch for this run instead of re-requesting it', async () => {
    await seed(ids(2));
    await brokenIndexedDb();
    await queue.enqueue('productInfo', ids(2));
    for (let i = 0; i < 3; i++) {
      await handleAlarm(ALARM_DRAIN);
      await whenIdle();
    }
    expect(calls('productInfo')).toHaveLength(1);
    expect((await readQueues()).productInfo.ids).toEqual([]);
  });
});

describe('§3.2.4 recheck', () => {
  it('rejects ids that are not tracked or paused and applies a 10-minute cooldown per work', async () => {
    await seed(ids(1));
    const items = await readItems();
    items.set('RJ00000009', item('RJ00000009', { paused: true }));
    await writeStore({ items });
    expect(await tracking.recheck(['RJ00000002'])).toEqual({ ok: false, reason: 'notTracked' });
    expect(await tracking.recheck(['RJ00000009'])).toEqual({ ok: false, reason: 'paused' });
    expect(await tracking.recheck(['RJ00000001'])).toEqual({ ok: true });
    expect(await tracking.recheck(['RJ00000001'])).toEqual({ ok: false, reason: 'cooldown' });
    expect(calls('productInfo')).toHaveLength(1);
  });
});

describe('§3.6 DLWatcher health', () => {
  const failing = (since: number, last = Date.now() - MIN) =>
    writeStore({ dlwatcherHealth: { allFailingSince: new Date(since).toISOString(), lastFailureAt: new Date(last).toISOString() } });
  const DAY = 24 * 60 * MIN;
  const brokenDlw = () =>
    apiGet.mockImplementation(async (key: string, p: { ids?: string[] }) =>
      key === 'productInfo' ? { ok: true, status: 200, text: productFor(p.ids!) } : { ok: true, status: 200, text: '{"broken":true}' },
    );

  it('auto-pauses DLWatcher after 7 days of failures and resumes on request', async () => {
    await seed(ids(2));
    brokenDlw();
    await failing(Date.now() - 6 * DAY);
    await queue.startRun();
    await whenIdle();
    expect((await readSettings()).dlwatcherAutoPausedAt).toBeUndefined();
    await failing(Date.now() - 7 * DAY - MIN);
    await writeStore({ dlwatcherLastRequest: new Map() });
    await queue.startRun();
    await whenIdle();
    const s = await readSettings();
    expect(s.dlwatcherAutoPausedAt).toBeDefined();
    // 暫停後第一件失敗就停了，第二件不再請求
    expect(calls('dlwatcher')).toHaveLength(3);
    expect((await readQueues()).dlwatcher.ids).toEqual([]);
    // 暫停中：新的一輪不請求 DLWatcher
    await writeStore({ dlwatcherLastRequest: new Map() });
    await queue.startRun();
    await whenIdle();
    expect(calls('dlwatcher')).toHaveLength(3);
    // resumeDlwatcher：清掉暫停與健康狀態，重新排進佇列
    apiGet.mockImplementation(async (key: string, p: { ids?: string[]; id?: string }) =>
      key === 'productInfo' ? { ok: true, status: 200, text: productFor(p.ids!) } : { ok: true, status: 200, text: dlwFor(p.id!) },
    );
    expect(await tracking.resumeDlwatcher()).toEqual({ ok: true });
    await vi.waitFor(() => expect(calls('dlwatcher')).toHaveLength(5));
    await whenIdle();
    expect((await readSettings()).dlwatcherAutoPausedAt).toBeUndefined();
    expect(await readDlwatcherHealth()).toEqual({});
  });

  it('a failure after a long quiet gap starts a new streak instead of pausing (M3 review)', async () => {
    await seed(ids(1));
    brokenDlw();
    // 8 天前失敗過一次，之後瀏覽器都關著
    await failing(Date.now() - 8 * DAY, Date.now() - 8 * DAY);
    await queue.startRun();
    await whenIdle();
    expect((await readSettings()).dlwatcherAutoPausedAt).toBeUndefined();
    const h = await readDlwatcherHealth();
    expect(Date.now() - Date.parse(h.allFailingSince!)).toBeLessThan(MIN);
  });

  it('any success clears the failing streak; 404 neither clears nor starts it', async () => {
    await seed(ids(1));
    apiGet.mockImplementation(async (key: string, p: { ids?: string[] }) =>
      key === 'productInfo' ? { ok: true, status: 200, text: productFor(p.ids!) } : { ok: false, kind: 'http', status: 404 },
    );
    await queue.startRun();
    await whenIdle();
    expect(await readDlwatcherHealth()).toEqual({});
    // 已經在失敗中：404 不清掉
    await failing(Date.now() - DAY);
    const before = await readDlwatcherHealth();
    await writeStore({ dlwatcherLastRequest: new Map() });
    await queue.startRun();
    await whenIdle();
    expect(await readDlwatcherHealth()).toEqual(before);
    // 成功一次就清掉
    await writeStore({ dlwatcherLastRequest: new Map() });
    apiGet.mockImplementation(async (key: string, p: { ids?: string[]; id?: string }) =>
      key === 'productInfo' ? { ok: true, status: 200, text: productFor(p.ids!) } : { ok: true, status: 200, text: dlwFor(p.id!) },
    );
    await queue.startRun();
    await whenIdle();
    expect(await readDlwatcherHealth()).toEqual({});
  });

  it('DLWatcher being unreachable counts as a failure only while DLsite is reachable (dead domain vs. offline)', async () => {
    await seed(ids(1));
    // DLsite 查得到、DLWatcher 連不上（網域失效、整站轉址）：算失敗
    apiGet.mockImplementation(async (key: string, p: { ids?: string[] }) =>
      key === 'productInfo' ? { ok: true, status: 200, text: productFor(p.ids!) } : { ok: false, kind: 'network' },
    );
    await queue.startRun();
    await whenIdle();
    expect((await readDlwatcherHealth()).allFailingSince).toBeDefined();
    expect((await readBackoff()).dlwatcher.networkFailures).toBe(1);
    expect((await readQueues()).dlwatcher.ids).toEqual(ids(1)); // 留在佇列稍後重試
    // 兩邊都連不上（自己離線）：不算
    await writeStore({ dlwatcherHealth: {}, backoff: { productInfo: { failures: 0 }, dlwatcher: { failures: 0 } } });
    apiGet.mockImplementation(async () => ({ ok: false, kind: 'network' }));
    await writeStore({ lastRunAt: new Date(0).toISOString() });
    await queue.startRun();
    await whenIdle();
    await clearNextAtAndKick('dlwatcher');
    expect(await readDlwatcherHealth()).toEqual({});
  });

  it('turning DLWatcher off clears its queue; turning it back on refills it', async () => {
    await seed(ids(2));
    await writeStore({ queues: { productInfo: { ids: [], nextIndex: 0 }, dlwatcher: { ids: ids(2), nextIndex: 0 } } });
    await tracking.updateSettings({ dlwatcherEnabled: false });
    await kick();
    expect((await readQueues()).dlwatcher.ids).toEqual([]);
    expect(calls('dlwatcher')).toHaveLength(0);
    await tracking.updateSettings({ dlwatcherEnabled: true });
    await vi.waitFor(() => expect(calls('dlwatcher')).toHaveLength(2));
    expect({ ...(await readSettings()), dlwatcherEnabled: true }).toEqual(defaultSettings());
  });
});
