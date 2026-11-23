import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

const FIXTURE = readFileSync(resolve(import.meta.dirname, 'fixtures/product-info-RJ01014447-RJ99999999.json'), 'utf8');

const apiGet = vi.fn();
vi.mock('../src/lib/api/endpoints', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));

const { __resetThrottleForTest, refreshPrices, trackItem, untrackItem, updateSettings } = await import('../src/lib/tracking');
const { readItems, readSettings, readSnapshots, writeStore } = await import('../src/lib/storage');

beforeEach(() => {
  fakeBrowser.reset();
  __resetThrottleForTest();
  apiGet.mockReset();
  apiGet.mockResolvedValue({ ok: true, status: 200, text: FIXTURE });
});

async function settle() {
  await vi.waitFor(async () => expect((await readSnapshots()).size).toBeGreaterThan(0));
  __resetThrottleForTest();
}

it('waits at least 1 second between product API requests (§3.1)', async () => {
  __resetThrottleForTest();
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
    const item = (await readItems()).get('RJ01014447')!;
    expect(item).toMatchObject({
      id: 'RJ01014447',
      source: 'manual',
      autoAdded: false,
      paused: false,
      site: 'home',
      title: expect.stringContaining('ねこぐらし'),
    });
    expect(item.baselineAt).toBeUndefined();
    const snap = (await readSnapshots()).get('RJ01014447')!;
    expect(snap).toMatchObject({ available: true, price: 1386, officialPrice: 1980, isDiscount: true, discountRate: 30 });
  });

  it('is idempotent', async () => {
    await trackItem('RJ01014447', 'manual');
    await settle();
    expect(await trackItem('RJ01014447', 'manual')).toEqual({ ok: true });
    expect(apiGet).toHaveBeenCalledTimes(1);
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
    apiGet.mockResolvedValue({ ok: true, status: 200, text: '[]' });
    await trackItem('RJ00000001', 'manual');
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect((await readSnapshots()).size).toBe(0);
    expect((await readItems()).has('RJ00000001')).toBe(true);
  });
});

describe('refreshPrices', () => {
  it('marks an item unavailable when it disappears, keeping prices', async () => {
    await trackItem('RJ01014447', 'manual');
    await settle();
    apiGet.mockResolvedValue({ ok: true, status: 200, text: '[]' });
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
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('reports API failures without touching data', async () => {
    await trackItem('RJ01014447', 'manual');
    await settle();
    apiGet.mockResolvedValue({ ok: false, kind: 'http', status: 503 });
    expect(await refreshPrices(['RJ01014447'])).toEqual({ ok: false, reason: 'http503' });
    expect((await readSnapshots()).get('RJ01014447')).toMatchObject({ available: true });
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
