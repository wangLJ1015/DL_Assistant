// §5.2 DLWatcher 的解析、§3.6 合理性檢查與「保留上一次的資料」。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { PriceLogEntry } from '../src/lib/models';

const FIXTURE = readFileSync(resolve(import.meta.dirname, 'fixtures/dlwatcher-RJ01014447.json'), 'utf8');
const PRODUCT = readFileSync(resolve(import.meta.dirname, 'fixtures/product-info-RJ01014447-RJ99999999.json'), 'utf8');

const apiGet = vi.fn();
vi.mock('../src/lib/api/endpoints', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));

const { checkDlwatcherSanity, isDivergent, parseDlwatcherResponse, toHistoryRecord } = await import('../src/lib/api/dlwatcher');
const { parseDlwatcherDate, curvePointDate } = await import('../src/lib/dates');
const { readHistory, writeHistory } = await import('../src/lib/db');
const { trackItem } = await import('../src/lib/tracking');
const { __setTimingForTest, whenIdle } = await import('../src/lib/queue');
const { readDlwatcherLastRequest, writeStore } = await import('../src/lib/storage');

const NOW = Date.UTC(2026, 10, 23, 15, 0, 0);
const parsed = () => {
  const r = parseDlwatcherResponse(FIXTURE, 'RJ01014447');
  if (!r.ok) throw new Error(r.reason);
  return r.data;
};
// 測試用：任意改 fixture 的欄位
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const mutate = (fn: (j: Json) => void) => {
  const j = JSON.parse(FIXTURE) as Json;
  fn(j);
  return JSON.stringify(j);
};

describe('§5.2 parseDlwatcherDate', () => {
  it('accepts the toISOString() format seen on 2026-11-23', () => {
    expect(parseDlwatcherDate('2024-07-11T13:40:03.000Z')).toBe('2024-07-11T13:40:03.000Z');
  });
  it.each(['2024-07-11 13:40:03', '2024-07-11T13:40:03Z', '2024-07-11T13:40:03.000+09:00', '2024-02-30T00:00:00.000Z', ''])(
    'rejects %j',
    (s) => expect(parseDlwatcherDate(s)).toBeNull(),
  );
  it('converts curve x to a date from JST Jan 1 (§5.2)', () => {
    expect(curvePointDate(2026, 0)).toBe('2025-12-31T15:00:00.000Z');
    expect(curvePointDate(2026, 1)).toBe('2026-12-31T15:00:00.000Z');
    expect(curvePointDate(2024, 0.5)).toBe('2024-07-01T15:00:00.000Z'); // 閏年 366 天的一半
  });
});

describe('§5.2 parseDlwatcherResponse (real response, 2026-11-23)', () => {
  it('reads lowest, recent sales, the yearly curve and counters', () => {
    const d = parsed();
    expect(d.lowest).toEqual({ price: 990, start: '2024-07-11T13:40:03.000Z', end: '2024-09-09T15:28:42.000Z' });
    expect(d.sales).toHaveLength(5);
    // discountRate 是浮點數（30.000000000000004），四捨五入成整數
    expect(d.sales[0]).toEqual({ price: 1386, rate: 30, start: '2026-11-20T11:50:27.000Z', end: '2026-11-23T10:32:34.000Z' });
    expect(d.regularPrice).toBe(1980);
    expect(d.discountDaysLastYear).toBe(281);
    expect(d.saleCount).toBe(22);
    // 走勢點的 x、y 是字串
    expect(d.points.length).toBe(84);
    expect(d.points[0]).toEqual({ year: 2024, x: 0, y: 0.8 });
  });

  it('builds a HistoryRecord with dated curve points in order', () => {
    const rec = toHistoryRecord(parsed(), '2026-11-23T15:00:00.000Z', false);
    expect(rec.curve[0]).toEqual({ date: '2023-12-31T15:00:00.000Z', ratio: 0.8 });
    expect(rec.curve.every((p, i) => i === 0 || rec.curve[i - 1]!.date <= p.date)).toBe(true);
    expect(rec).not.toHaveProperty('divergent');
    // 不保存 DLWatcher 的網址、名稱等用不到的欄位（§5.2）
    expect(JSON.stringify(rec)).not.toMatch(/https?:|img\.dlsite|ねこぐらし/);
  });

  it('rejects responses for another work, HTML, and broken fields', () => {
    expect(parseDlwatcherResponse(FIXTURE, 'RJ01014448')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(parseDlwatcherResponse('<!DOCTYPE html>', 'RJ01014447')).toEqual({ ok: false, reason: 'unparsable' });
    for (const bad of [
      mutate((j) => (j.lowestPrice.start = '2024-07-11 13:40:03')),
      mutate((j) => (j.recentSalePriceLog[0].end = 1)),
      mutate((j) => (j.priceLogGraph.graphs = [])),
      mutate((j) => (j.priceLogGraph.graphs = { __proto__x: { points: [] }, abcd: { points: [] } })),
      mutate((j) => (j.priceLogGraph.graphs['2024'].points[0].x = '1e3')),
      mutate((j) => (j.lowestPrice.priceInfo.price = -1)),
    ]) {
      expect(parseDlwatcherResponse(bad, 'RJ01014447').ok).toBe(false);
    }
  });

  it('a "__proto__" year key does not pollute prototypes (§3.2.3)', () => {
    const text = FIXTURE.replace('"2024":', '"__proto__":');
    expect(parseDlwatcherResponse(text, 'RJ01014447').ok).toBe(false);
    expect(({} as Record<string, unknown>).points).toBeUndefined();
  });

  it('accepts a missing lowest price (never discounted)', () => {
    const r = parseDlwatcherResponse(
      mutate((j) => {
        j.lowestPrice = null;
        delete j.recentSalePriceLog;
      }),
      'RJ01014447',
    );
    expect(r).toMatchObject({ ok: true, data: { lowest: null, sales: [] } });
  });
});

describe('§3.6 sanity check', () => {
  const log = (price: number, officialPrice = 1980): PriceLogEntry => ({
    id: 'RJ01014447',
    price,
    officialPrice,
    isDiscount: price < officialPrice,
    discountRate: 0,
    at: '2026-11-20T00:00:00.000Z',
    lastSeenAt: '2026-11-20T00:00:00.000Z',
  });

  it('passes the real response', () => {
    expect(checkDlwatcherSanity(parsed(), [], NOW)).toBeNull();
  });

  it.each([
    ['lowest above the regular price', { price: 1981 }, 'lowestTooHigh'],
    ['lowest below 5% of the regular price', { price: 98 }, 'lowestTooLow'],
    ['start after end', { start: '2024-09-10T00:00:00.000Z' }, 'badPeriod'],
    ['start in the future', { start: '2026-11-25T00:00:00.000Z', end: '2026-11-26T00:00:00.000Z' }, 'badPeriod'],
  ])('%s', (_, patch, reason) => {
    const d = parsed();
    d.lowest = { ...d.lowest!, ...patch };
    expect(checkDlwatcherSanity(d, [], NOW)).toBe(reason);
  });

  it('allows a lowest up to the highest official price seen in our own log (regular price was lowered)', () => {
    const d = parsed();
    d.lowest = { ...d.lowest!, price: 2200 };
    expect(checkDlwatcherSanity(d, [], NOW)).toBe('lowestTooHigh');
    expect(checkDlwatcherSanity(d, [log(2200, 2200)], NOW)).toBeNull();
  });

  it('allows exactly floor(regular × 0.05)', () => {
    const d = parsed();
    d.lowest = { ...d.lowest!, price: 99 };
    expect(checkDlwatcherSanity(d, [], NOW)).toBeNull();
  });

  it('rejects curve points outside 0～1', () => {
    for (const p of [
      { x: 1.01, y: 0.5 },
      { x: 0.5, y: -0.1 },
      { x: 0.5, y: 1.2 },
    ]) {
      const d = parsed();
      d.points.push({ year: 2026, ...p });
      expect(checkDlwatcherSanity(d, [], NOW)).toBe('curveOutOfRange');
    }
  });

  it('flags a new lowest more than 50% below the previous one that our own log never saw', () => {
    const prev = toHistoryRecord(parsed(), '2026-11-22T00:00:00.000Z', false); // 990
    const d = parsed();
    d.lowest = { ...d.lowest!, price: 400 };
    expect(isDivergent(d, prev, [])).toBe(true);
    expect(isDivergent(d, prev, [log(410)])).toBe(false); // 差距 5% 以內
    d.lowest.price = 500; // 沒有低超過 50%
    expect(isDivergent(d, prev, [])).toBe(false);
    // 史低沒變：沿用上次的標示
    const flagged = { ...prev, lowest: { ...prev.lowest!, price: 400 }, divergent: true as const };
    d.lowest.price = 400;
    expect(isDivergent(d, flagged, [])).toBe(true);
  });
});

describe('§3.6 keeps the previous history when the new response fails (M3 completion)', () => {
  let dlwatcherResponse: unknown;
  beforeEach(() => {
    fakeBrowser.reset();
    __setTimingForTest({ productIntervalMs: 0, dlwatcherIntervalMs: 0 });
    apiGet.mockReset();
    apiGet.mockImplementation(async (key: string) =>
      key === 'productInfo' ? { ok: true, status: 200, text: PRODUCT } : dlwatcherResponse,
    );
  });
  afterEach(async () => {
    await whenIdle();
    __setTimingForTest();
  });

  const old = () => toHistoryRecord(parsed(), '2026-11-01T00:00:00.000Z', false);

  it.each([
    ['lowest too high', mutate((j) => (j.lowestPrice.priceInfo.price = 5000))],
    ['lowest too low', mutate((j) => (j.lowestPrice.priceInfo.price = 1))],
    ['start > end', mutate((j) => (j.lowestPrice.start = '2024-09-10T00:00:00.000Z'))],
    ['curve point outside 0～1', mutate((j) => (j.priceLogGraph.graphs['2026'].points[0].y = '1.5'))],
    ['validation failure', mutate((j) => (j.lowestPrice.end = 'yesterday'))],
  ])('%s', async (_, text) => {
    await writeHistory({ ...old(), id: 'RJ01014447' });
    dlwatcherResponse = { ok: true, status: 200, text };
    await trackItem('RJ01014447', 'manual', { awaitPrice: true });
    await whenIdle();
    expect(apiGet).toHaveBeenCalledWith('dlwatcher', { id: 'RJ01014447' });
    expect(await readHistory('RJ01014447')).toEqual(old());
  });

  it('keeps the previous history on 404 and network errors too', async () => {
    await writeHistory(old());
    dlwatcherResponse = { ok: false, kind: 'http', status: 404 };
    await trackItem('RJ01014447', 'manual', { awaitPrice: true });
    await whenIdle();
    expect(await readHistory('RJ01014447')).toEqual(old());
  });

  it('saves a valid response and records the request time (§3.1)', async () => {
    dlwatcherResponse = { ok: true, status: 200, text: FIXTURE };
    await trackItem('RJ01014447', 'manual', { awaitPrice: true });
    await whenIdle();
    expect((await readHistory('RJ01014447'))?.lowest).toMatchObject({ price: 990 });
    expect((await readDlwatcherLastRequest()).has('RJ01014447')).toBe(true);
  });

  it('does not request DLWatcher when it is turned off', async () => {
    await writeStore({ settings: { ...(await import('../src/lib/models')).defaultSettings(), dlwatcherEnabled: false } });
    dlwatcherResponse = { ok: true, status: 200, text: FIXTURE };
    await trackItem('RJ01014447', 'manual', { awaitPrice: true });
    await whenIdle();
    expect(apiGet.mock.calls.filter(([k]) => k === 'dlwatcher')).toHaveLength(0);
  });
});
