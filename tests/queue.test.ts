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

  it('DLWatcher is requested at most once per work in 24 hours, also across a new run (§3.1)', async () => {
    await seed(ids(3));
    await queue.startRun();
    await whenIdle();
    await queue.startRun();
    await whenIdle();
    expect(calls('dlwatcher')).toHaveLength(3);
    expect(calls('productInfo')).toHaveLength(2);
    // 25 小時前的紀錄就可以再請求
    const last = await readDlwatcherLastRequest();
    last.set('RJ00000001', new Date(Date.now() - 25 * 60 * MIN).toISOString());
    await writeStore({ dlwatcherLastRequest: last });
    await queue.startRun();
    await whenIdle();
    expect(calls('dlwatcher')).toHaveLength(4);
  });

  it('resumes from the stored progress after the service worker stops mid-run (M3 completion)', async () => {
    // 每次喚醒只給 1 毫秒：處理一步就停下來、設 drain alarm（模擬中途被終止，記憶體裡的狀態不重要）
    __setTimingForTest({ productIntervalMs: 0, dlwatcherIntervalMs: 0, runBudgetMs: 1 });
    await seed(ids(5));
    await queue.startRun();
    await whenIdle();
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

describe('§3.1 backoff', () => {
  it('429／5xx back off 1, 2, 4 minutes, then pause the source for 6 hours; DLWatcher keeps going', async () => {
    await seed(ids(2));
    apiGet.mockImplementation(async (key: string, p: { id?: string }) =>
      key === 'productInfo' ? { ok: false, kind: 'http', status: 503 } : { ok: true, status: 200, text: dlwFor(p.id!) },
    );
    const t0 = Date.now();
    await queue.startRun();
    await whenIdle();
    let q = await readQueues();
    expect((await readBackoff()).productInfo).toEqual({ failures: 1 });
    expect(Date.parse(q.productInfo.nextAt!) - t0).toBeGreaterThanOrEqual(MIN);
    // 一個來源在退避時不會卡住另一個（§4.1）
    expect(calls('dlwatcher')).toHaveLength(2);
    const expectWait = async (failures: number, waitMs: number) => {
      const qs = await readQueues();
      const { nextAt: _, ...rest } = qs.productInfo;
      await writeStore({ queues: { ...qs, productInfo: rest } });
      const t = Date.now();
      await kick();
      q = await readQueues();
      const b = await readBackoff();
      if (failures > 0) {
        expect(b.productInfo).toEqual({ failures });
        expect(Date.parse(q.productInfo.nextAt!) - t).toBeGreaterThanOrEqual(waitMs);
      }
      return b;
    };
    await expectWait(2, 2 * MIN);
    const b = await expectWait(0, 0);
    expect(b.productInfo.failures).toBe(0);
    expect(Date.parse(b.productInfo.pausedUntil!) - Date.now()).toBeGreaterThan(5.9 * 60 * MIN);
    // 暫停中：不再請求
    const before = calls('productInfo').length;
    await expectWait(0, 0);
    expect(calls('productInfo')).toHaveLength(before);
    expect((await readQueues()).productInfo.ids).toEqual(ids(2));
    // 成功一次就清掉退避
    await writeStore({ backoff: { productInfo: { failures: 2 }, dlwatcher: { failures: 0 } } });
    apiGet.mockImplementation(async (_k: string, p: { ids: string[] }) => ({ ok: true, status: 200, text: productFor(p.ids) }));
    const qs = await readQueues();
    const { nextAt: _n, ...rest } = qs.productInfo;
    await writeStore({ queues: { ...qs, productInfo: rest } });
    await kick();
    expect((await readBackoff()).productInfo).toEqual({ failures: 0 });
    expect((await readQueues()).productInfo.ids).toEqual([]);
  });

  it('a recheck during backoff replies "backoff" without sending a request', async () => {
    await seed(ids(1));
    await writeStore({
      backoff: { productInfo: { failures: 0, pausedUntil: new Date(Date.now() + 60 * MIN).toISOString() }, dlwatcher: { failures: 0 } },
    });
    expect(await tracking.recheck(['RJ00000001'])).toEqual({ ok: false, reason: 'backoff' });
    expect(calls('productInfo')).toHaveLength(0);
  });

  it('splits a batch rejected with 4xx and marks only the bad id as not found (§4.1)', async () => {
    const all = ids(5);
    await seed(all);
    apiGet.mockImplementation(async (key: string, p: { ids?: string[] }) => {
      if (key !== 'productInfo') return { ok: false, kind: 'http', status: 404 };
      return p.ids!.includes('RJ00000004') ? { ok: false, kind: 'http', status: 400 } : { ok: true, status: 200, text: productFor(p.ids!) };
    });
    expect(await tracking.refreshPrices(all)).toEqual({ ok: true, updated: 4, missing: 1, invalid: 0 });
    const items = await readItems();
    expect(items.get('RJ00000004')!.notFoundCount).toBe(1);
    expect(items.get('RJ00000003')!.notFoundCount).toBeUndefined();
    expect((await readBackoff()).productInfo.failures).toBe(0);
  });
});

describe('§3.2.4 recheck', () => {
  it('rejects ids that are not tracked and applies a 10-minute cooldown per work', async () => {
    await seed(ids(1));
    expect(await tracking.recheck(['RJ00000002'])).toEqual({ ok: false, reason: 'notTracked' });
    expect(await tracking.recheck(['RJ00000001'])).toEqual({ ok: true });
    expect(await tracking.recheck(['RJ00000001'])).toEqual({ ok: false, reason: 'cooldown' });
    expect(calls('productInfo')).toHaveLength(1);
  });
});

describe('§3.6 DLWatcher health', () => {
  const failing = (since: number) => writeStore({ dlwatcherHealth: { allFailingSince: new Date(since).toISOString() } });

  it('auto-pauses DLWatcher after 7 days of failures and resumes on request', async () => {
    await seed(ids(2));
    apiGet.mockImplementation(async (key: string, p: { ids?: string[] }) =>
      key === 'productInfo' ? { ok: true, status: 200, text: productFor(p.ids!) } : { ok: true, status: 200, text: '{"broken":true}' },
    );
    await failing(Date.now() - 6 * 24 * 60 * MIN);
    await queue.startRun();
    await whenIdle();
    expect((await readSettings()).dlwatcherAutoPausedAt).toBeUndefined();
    await failing(Date.now() - 7 * 24 * 60 * MIN - MIN);
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

  it('any success clears the failing streak; 404 neither clears nor starts it', async () => {
    await seed(ids(1));
    apiGet.mockImplementation(async (key: string, p: { ids?: string[] }) =>
      key === 'productInfo' ? { ok: true, status: 200, text: productFor(p.ids!) } : { ok: false, kind: 'http', status: 404 },
    );
    await queue.startRun();
    await whenIdle();
    expect(await readDlwatcherHealth()).toEqual({});
    await failing(Date.now() - 24 * 60 * MIN);
    await writeStore({ dlwatcherLastRequest: new Map() });
    apiGet.mockImplementation(async (key: string, p: { ids?: string[]; id?: string }) =>
      key === 'productInfo' ? { ok: true, status: 200, text: productFor(p.ids!) } : { ok: true, status: 200, text: dlwFor(p.id!) },
    );
    await queue.startRun();
    await whenIdle();
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
