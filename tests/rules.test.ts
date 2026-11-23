import { describe, expect, it } from 'vitest';
import type { PriceSnapshot } from '../src/lib/models';
import { isOnSale } from '../src/lib/rules';

const NOW = Date.parse('2026-11-23T03:00:00.000Z');
const base: PriceSnapshot = {
  id: 'RJ01014447',
  available: true,
  price: 1386,
  officialPrice: 1980,
  isDiscount: true,
  discountRate: 30,
  discountEnd: '2026-11-28T14:59:59.000Z',
  pointRate: 1,
  couponFacts: { siteId: 'home', workType: 'SOU', customGenres: [], noReduction: false },
  checkedAt: '2026-11-23T03:00:00.000Z',
};

describe('§6 isOnSale', () => {
  it('is true for an available discount that has not ended', () => {
    expect(isOnSale(base, NOW)).toBe(true);
    const { discountEnd: _, ...noEnd } = base;
    expect(isOnSale(noEnd, NOW)).toBe(true);
  });
  it.each<[string, Partial<PriceSnapshot>]>([
    ['unavailable', { available: false }],
    ['not discounted', { isDiscount: false }],
    ['stale end date (§5.5 step 4)', { discountEndStale: true }],
    ['ended', { discountEnd: '2026-11-23T02:59:59.000Z' }],
    ['ends exactly now', { discountEnd: '2026-11-23T03:00:00.000Z' }],
  ])('is false when %s', (_, patch) => {
    expect(isOnSale({ ...base, ...patch }, NOW)).toBe(false);
  });
});
