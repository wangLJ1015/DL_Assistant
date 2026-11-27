import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

const FIXTURE = readFileSync(resolve(import.meta.dirname, 'fixtures/product-info-RJ01014447-RJ99999999.json'), 'utf8');

const apiGet = vi.fn();
vi.mock('../src/lib/api/endpoints', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));

const { refreshPrices, trackItem, untrackItem, updateSettings } = await import('../src/lib/tracking');
const { __setTimingForTest, whenIdle } = await import('../src/lib/queue');
const { emptyQueues, readBackoff, readItems, readQueues, readSettings, readSnapshots, writeStore } = await import('../src/lib/storage');

// 商品 API 回 fixture；DLWatcher 回 404（這個檔案只測商品 API）。
let productResponse: unknown;
apiGet.mockImplementation(async (key: string) => (key === 'productInfo' ? productResponse : { ok: false, kind: 'http', status: 404 }));
const productCalls = () => apiGet.mock.calls.filter(([key]) => key === 'productInfo');

beforeEach(() => {
  fakeBrowser.reset();
  __setTimingForTest({ productIntervalMs: 0, dlwatcherIntervalMs: 0 });
  apiGet.mockClear();
  productResponse = { ok: true, status: 200, text: FIXTURE };
});

afterEach(async () => {
  await whenIdle();
  __setTimingForTest();
});

async function settle() {
  await vi.waitFor(async () => expect((await readSnapshots()).size).toBeGreaterThan(0));
  await whenIdle();
}

/** 清掉請求間隔與退避（模擬時間過去）。 */
async function clearWaits() {
  const queues = await readQueues();
  const { nextAt: _a, ...p } = queues.productInfo;
  const { nextAt: _b, ...d } = queues.dlwatcher;
  await writeStore({
    queues: { productInfo: p, dlwatcher: d },
    backoff: { productInfo: { failures: 0 }, dlwatcher: { failures: 0 } },
  });
}

it('waits at least 1 second between product API requests (§3.1)', async () => {
  __setTimingForTest({ dlwatcherIntervalMs: 0 });
  await writeStore({
    items: new Map(
      ['RJ01014447', 'RJ99999999'].map((id) => [
        id,
        {
          id,
          site: 'maniax',
          title: '',
          imageUrl: '',
          addedAt: '2026-11-23T00:00:00.000Z',
          source: 'manual' as const,
          autoAdded: false,
          paused: false,
        },
      ]),
    ),
  });
  const t0 = Date.now();
  await refreshPrices(['RJ01014447']);
  await refreshPrices(['RJ99999999']);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(990);
});

describe('track (M1: popup manual add)', () => {
  it('adds the item and fetches the current price', async () => {
    expect(await trackItem('RJ01014447', 'manual')).toEqual({ ok: true });
    await settle();
    expect(apiGet).toHaveBeenCalledWith('productInfo', { ids: ['RJ01014447'] });
    // 新加入的作品也排進 DLWatcher 佇列（§5.2）
    await whenIdle();
    expect(apiGet).toHaveBeenCalledWith('dlwatcher', { id: 'RJ01014447' });
    const item = (await readItems()).get('RJ01014447')!;
    expect(item).toMatchObject({
      id: 'RJ01014447',
      source: 'manual',
      autoAdded: false,
      paused: false,
      site: 'home',
      title: expect.stringContaining('ねこぐらし'),
    });
    const snap = (await readSnapshots()).get('RJ01014447')!;
    // §6.1 第 6 步：第一次查價只建立基準，不通知
    expect(item.baselineAt).toBe(snap.checkedAt);
    expect(snap).toMatchObject({ available: true, price: 1386, officialPrice: 1980, isDiscount: true, discountRate: 30 });
  });

  it('is idempotent', async () => {
    await trackItem('RJ01014447', 'manual');
    await settle();
    expect(await trackItem('RJ01014447', 'manual')).toEqual({ ok: true });
    expect(productCalls()).toHaveLength(1);
    expect((await readItems()).size).toBe(1);
  });

  it('rejects invalid ids', async () => {
    expect(await trackItem('__proto__', 'manual')).toEqual({ ok: false, reason: 'invalidId' });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('enforces the 1,000-item limit', async () => {
    const items = new Map(
      Array.from({ length: 1000 }, (_, i) => {
        const id = `RJ${String(i).padStart(8, '0')}`;
        return [
          id,
          {
            id,
            site: 'maniax',
            title: '',
            imageUrl: '',
            addedAt: '2026-11-23T00:00:00.000Z',
            source: 'manual' as const,
            autoAdded: false,
            paused: false,
          },
        ];
      }),
    );
    await writeStore({ items });
    expect(await trackItem('RJ01014447', 'manual')).toEqual({ ok: false, reason: 'limit' });
  });

  it('does not write a snapshot when the work does not exist', async () => {
    productResponse = { ok: true, status: 200, text: '[]' };
    await trackItem('RJ00000001', 'manual');
    await vi.waitFor(() => expect(productCalls()).toHaveLength(1));
    await whenIdle();
    expect((await readSnapshots()).size).toBe(0);
    expect((await readItems()).has('RJ00000001')).toBe(true);
  });
});

describe('refreshPrices', () => {
  it('marks an item unavailable when it disappears, keeping prices', async () => {
    await trackItem('RJ01014447', 'manual');
    await settle();
    productResponse = { ok: true, status: 200, text: '[]' };
    expect(await refreshPrices(['RJ01014447'])).toEqual({ ok: true, updated: 0, missing: 1, invalid: 0 });
    expect((await readSnapshots()).get('RJ01014447')).toMatchObject({ available: false, price: 1386 });
  });

  it('skips paused items', async () => {
    await trackItem('RJ01014447', 'manual');
    await settle();
    const items = await readItems();
    items.set('RJ01014447', { ...items.get('RJ01014447')!, paused: true });
    await writeStore({ items });
    apiGet.mockClear();
    await refreshPrices(['RJ01014447']);
    expect(productCalls()).toHaveLength(0);
  });

  it('reports API failures without touching data', async () => {
    await trackItem('RJ01014447', 'manual');
    await settle();
    productResponse = { ok: false, kind: 'http', status: 503 };
    expect(await refreshPrices(['RJ01014447'])).toEqual({ ok: false, reason: 'http503' });
    expect((await readSnapshots()).get('RJ01014447')).toMatchObject({ available: true });
    // §3.1：5xx 計入退避，作品留在佇列等重試
    expect((await readBackoff()).productInfo.failures).toBe(1);
    expect((await readQueues()).productInfo.ids).toEqual(['RJ01014447']);
  });
});

describe('untrack / settings', () => {
  it('removes the item and its snapshot', async () => {
    await trackItem('RJ01014447', 'manual');
    await settle();
    expect(await untrackItem('RJ01014447')).toEqual({ ok: true });
    expect((await readItems()).size).toBe(0);
    expect((await readSnapshots()).size).toBe(0);
  });

  it('merges a settings partial', async () => {
    await updateSettings({ checkIntervalHours: 2 });
    expect((await readSettings()).checkIntervalHours).toBe(2);
    expect((await readSettings()).dlwatcherEnabled).toBe(true);
  });
});

describe('M1 review fixes', () => {
  const broken = () => {
    const data = JSON.parse(FIXTURE) as Record<string, Record<string, unknown>>;
    data.RJ01014447!.is_noreduction = null;
    return JSON.stringify(data);
  };

  it('a record that fails validation keeps its snapshot instead of turning unavailable (§3.2.3)', async () => {
    await trackItem('RJ01014447', 'manual');
    await settle();
    productResponse = { ok: true, status: 200, text: broken() };
    expect(await refreshPrices(['RJ01014447'])).toEqual({ ok: true, updated: 0, missing: 0, invalid: 1 });
    expect((await readSnapshots()).get('RJ01014447')).toMatchObject({ available: true, price: 1386 });
    expect((await readItems()).get('RJ01014447')!.notFoundCount).toBeUndefined();
  });

  it('counts consecutive not-found checks and clears the count once found (§5.3)', async () => {
    productResponse = { ok: true, status: 200, text: '[]' };
    await trackItem('RJ01014447', 'manual', { awaitPrice: true });
    expect((await readItems()).get('RJ01014447')!.notFoundCount).toBe(1);
    await refreshPrices(['RJ01014447']);
    await refreshPrices(['RJ01014447']);
    expect((await readItems()).get('RJ01014447')!.notFoundCount).toBe(3);
    expect((await readSnapshots()).size).toBe(0);
    productResponse = { ok: true, status: 200, text: FIXTURE };
    await refreshPrices(['RJ01014447']);
    expect((await readItems()).get('RJ01014447')!.notFoundCount).toBeUndefined();
    expect((await readSnapshots()).get('RJ01014447')).toMatchObject({ available: true });
  });

  it('awaitPrice waits for the first check, and re-adding a work without a price checks again', async () => {
    productResponse = { ok: false, kind: 'network' };
    expect(await trackItem('RJ01014447', 'manual', { awaitPrice: true })).toEqual({ ok: true });
    expect(productCalls()).toHaveLength(1);
    expect((await readSnapshots()).size).toBe(0);
    // 連不上：留在佇列，1 分鐘後重試（不計入退避）
    expect((await readQueues()).productInfo.ids).toEqual(['RJ01014447']);
    expect((await readBackoff()).productInfo.failures).toBe(0);
    await whenIdle();
    await clearWaits();
    productResponse = { ok: true, status: 200, text: FIXTURE };
    expect(await trackItem('RJ01014447', 'manual', { awaitPrice: true })).toEqual({ ok: true });
    expect(productCalls()).toHaveLength(2);
    expect((await readSnapshots()).get('RJ01014447')).toMatchObject({ available: true });
    expect((await readQueues()).productInfo).toEqual({ ...emptyQueues().productInfo, nextAt: expect.any(String) });
    // 已經有價格時再加一次不會重新查價
    await trackItem('RJ01014447', 'manual', { awaitPrice: true });
    expect(productCalls()).toHaveLength(2);
  });
});
