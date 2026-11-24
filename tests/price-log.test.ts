// §5.3 priceLog 的新增規則、§3.6 自己的史低與走勢（M3 完成標準）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { defaultSettings, type HistoryRecord, type PriceLogEntry } from '../src/lib/models';
import { nextPriceLogEntry, priceLogGapMs, type PriceObservation } from '../src/lib/price-log';
import { buildTrend, ownLowest, ownTrend, summarizeLowest } from '../src/lib/history';

const PRODUCT = readFileSync(resolve(import.meta.dirname, 'fixtures/product-info-RJ01014447-RJ99999999.json'), 'utf8');

const apiGet = vi.fn();
vi.mock('../src/lib/api/endpoints', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));

const { appendPriceObservations, readPriceLog } = await import('../src/lib/db');
const { refreshPrices, trackItem } = await import('../src/lib/tracking');
const { __setTimingForTest, whenIdle } = await import('../src/lib/queue');

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 1);
const iso = (ms: number) => new Date(ms).toISOString();
const GAP = priceLogGapMs(6); // 12 小時

const obs = (hours: number, patch: Partial<PriceObservation> = {}): PriceObservation => ({
  id: 'RJ01014447',
  price: 1980,
  officialPrice: 1980,
  isDiscount: false,
  discountRate: 0,
  at: iso(T0 + hours * H),
  ...patch,
});
const unavailable = (hours: number) => obs(hours, { status: 'unavailable' });

describe('§5.3 nextPriceLogEntry', () => {
  it('creates the first entry', () => {
    expect(nextPriceLogEntry(undefined, obs(0), GAP)).toEqual({
      isNew: true,
      entry: { id: 'RJ01014447', price: 1980, officialPrice: 1980, isDiscount: false, discountRate: 0, at: iso(T0), lastSeenAt: iso(T0) },
    });
  });

  it('only extends lastSeenAt when nothing changed within 2 × the check interval', () => {
    const first = nextPriceLogEntry(undefined, obs(0), GAP)!.entry;
    expect(nextPriceLogEntry(first, obs(6), GAP)).toEqual({ isNew: false, entry: { ...first, lastSeenAt: iso(T0 + 6 * H) } });
    expect(nextPriceLogEntry(first, obs(12), GAP)?.isNew).toBe(false);
    expect(nextPriceLogEntry(first, obs(12.01), GAP)?.isNew).toBe(true);
  });

  it.each([
    ['price', { price: 990 }],
    ['officialPrice', { officialPrice: 1650 }],
    ['isDiscount', { isDiscount: true }],
    ['discountRate', { discountRate: 10 }],
    ['campaignId', { campaignId: 'c1' }],
    ['status', { status: 'unavailable' as const }],
  ])('adds an entry when %s changes', (_, patch) => {
    const first = nextPriceLogEntry(undefined, obs(0), GAP)!.entry;
    expect(nextPriceLogEntry(first, obs(6, patch), GAP)?.isNew).toBe(true);
  });

  it('ignores observations not later than the last one (clock went back)', () => {
    const first = nextPriceLogEntry(undefined, obs(6), GAP)!.entry;
    expect(nextPriceLogEntry(first, obs(5), GAP)).toBeNull();
    expect(nextPriceLogEntry(first, obs(6), GAP)).toBeNull();
  });
});

describe('§5.3 priceLog in IndexedDB (M3 completion)', () => {
  it('available → not found ×3 → available at the same price gives 3 entries', async () => {
    for (const o of [obs(0), unavailable(6), unavailable(12), unavailable(18), obs(24)]) await appendPriceObservations([o], GAP);
    const log = await readPriceLog('RJ01014447');
    expect(log.map((e) => [e.status ?? 'ok', e.at, e.lastSeenAt])).toEqual([
      ['ok', iso(T0), iso(T0)],
      ['unavailable', iso(T0 + 6 * H), iso(T0 + 18 * H)],
      ['ok', iso(T0 + 24 * H), iso(T0 + 24 * H)],
    ]);
  });

  it('browser closed for 3 days with the same price before and after gives 2 entries, drawn dashed in between', async () => {
    for (const o of [obs(0), obs(6), obs(6 + 72)]) await appendPriceObservations([o], GAP);
    const log = await readPriceLog('RJ01014447');
    expect(log.map((e) => [e.at, e.lastSeenAt])).toEqual([
      [iso(T0), iso(T0 + 6 * H)],
      [iso(T0 + 78 * H), iso(T0 + 78 * H)],
    ]);
    expect(ownTrend(log)).toEqual([
      { from: iso(T0), to: iso(T0 + 6 * H), price: 1980, kind: 'seen' },
      { from: iso(T0 + 6 * H), to: iso(T0 + 78 * H), price: 1980, kind: 'gap' },
      { from: iso(T0 + 78 * H), to: iso(T0 + 78 * H), price: 1980, kind: 'seen' },
    ]);
  });

  it('writes several works in one transaction and keeps them apart', async () => {
    await appendPriceObservations(
      [obs(0), obs(0, { id: 'RJ01014448', price: 500 }), obs(0, { id: 'RJ123456' }), obs(0, { id: 'RJ12345678' })],
      GAP,
    );
    await appendPriceObservations([obs(6), obs(6, { id: 'RJ01014448', price: 400 })], GAP);
    expect(await readPriceLog('RJ01014447')).toHaveLength(1);
    expect((await readPriceLog('RJ01014448')).map((e) => e.price)).toEqual([500, 400]);
    // 'RJ123456' 是 'RJ12345678' 的前綴：範圍查詢不能混在一起
    expect(await readPriceLog('RJ123456')).toHaveLength(1);
    expect(await readPriceLog('RJ12345678')).toHaveLength(1);
  });
});

describe('§3.6 own lowest and the DLWatcher switch', () => {
  const log: PriceLogEntry[] = [
    { id: 'RJ01014447', price: 1980, officialPrice: 1980, isDiscount: false, discountRate: 0, at: iso(T0), lastSeenAt: iso(T0 + 6 * H) },
    {
      id: 'RJ01014447',
      price: 990,
      officialPrice: 1980,
      isDiscount: true,
      discountRate: 50,
      at: iso(T0 + 12 * H),
      lastSeenAt: iso(T0 + 30 * H),
    },
    {
      id: 'RJ01014447',
      price: 500,
      officialPrice: 1980,
      isDiscount: true,
      discountRate: 75,
      at: iso(T0 + 36 * H),
      lastSeenAt: iso(T0 + 36 * H),
      status: 'unavailable',
    },
  ];
  const history: HistoryRecord = {
    id: 'RJ01014447',
    lowest: { price: 800, start: '2024-07-11T13:40:03.000Z', end: '2024-09-09T15:28:42.000Z' },
    sales: [],
    curve: [{ date: '2023-12-31T15:00:00.000Z', ratio: 0.5 }],
    regularPrice: 1980,
    fetchedAt: '2026-11-01T00:00:00.000Z',
  };

  it('own lowest ignores "unavailable" entries and dates tracking from the first valid entry', () => {
    expect(ownLowest(log)).toEqual({ price: 990, start: iso(T0 + 12 * H), end: iso(T0 + 30 * H), since: iso(T0) });
    expect(ownLowest([log[2]!])).toBeUndefined();
  });

  it('shows both numbers while DLWatcher is on', () => {
    const s = summarizeLowest(history, log, defaultSettings());
    expect(s.dlwatcher).toMatchObject({ price: 800, divergent: false });
    expect(s.own?.price).toBe(990);
    expect(s.best).toEqual({ price: 800, source: 'dlwatcher' });
    expect(buildTrend(history, log, defaultSettings())).toEqual({
      source: 'dlwatcher',
      segments: [{ from: '2023-12-31T15:00:00.000Z', to: history.fetchedAt, price: 990, kind: 'curve' }],
    });
  });

  it('switches lowest and trend to our own log when DLWatcher is turned off or auto-paused (M3 completion)', () => {
    for (const settings of [
      { ...defaultSettings(), dlwatcherEnabled: false },
      { ...defaultSettings(), dlwatcherAutoPausedAt: '2026-11-20T00:00:00.000Z' },
    ]) {
      const s = summarizeLowest(history, log, settings);
      expect(s.dlwatcher).toBeUndefined();
      expect(s.best).toEqual({ price: 990, source: 'own' });
      const trend = buildTrend(history, log, settings);
      expect(trend.source).toBe('own');
      expect(trend.segments.filter((x) => x.kind === 'gap')).toHaveLength(2);
      // 查不到的那一筆不畫價格
      expect(trend.segments.at(-1)).toMatchObject({ kind: 'seen', price: null });
    }
  });
});

describe('priceLog written by product checks', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    __setTimingForTest({ productIntervalMs: 0, dlwatcherIntervalMs: 0 });
    apiGet.mockReset();
  });
  afterEach(async () => {
    await whenIdle();
    __setTimingForTest();
  });

  it('logs available → unavailable ×3 → available as 3 entries through the real check path', async () => {
    let text = PRODUCT;
    apiGet.mockImplementation(async (key: string) =>
      key === 'productInfo' ? { ok: true, status: 200, text } : { ok: false, kind: 'http', status: 404 },
    );
    await trackItem('RJ01014447', 'manual', { awaitPrice: true });
    text = '[]';
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 2));
      await refreshPrices(['RJ01014447']);
    }
    text = PRODUCT;
    await new Promise((r) => setTimeout(r, 2));
    await refreshPrices(['RJ01014447']);
    const log = await readPriceLog('RJ01014447');
    expect(log.map((e) => e.status ?? 'ok')).toEqual(['ok', 'unavailable', 'ok']);
    // 查不到的那一筆沿用最後一次的價格
    expect(log[1]).toMatchObject({ price: 1386, officialPrice: 1980 });
  });

  it('does not log a work that was never found (§5.3)', async () => {
    apiGet.mockImplementation(async (key: string) =>
      key === 'productInfo' ? { ok: true, status: 200, text: '[]' } : { ok: false, kind: 'http', status: 404 },
    );
    await trackItem('RJ00000001', 'manual', { awaitPrice: true });
    expect(await readPriceLog('RJ00000001')).toEqual([]);
  });
});
