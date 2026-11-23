import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { intIn, optionalText, truncateChars } from '../src/lib/schema';
import { parseProductInfoResponse, toSnapshot, unavailableSnapshot } from '../src/lib/api/dlsite';

const FIXTURE = readFileSync(resolve(import.meta.dirname, 'fixtures/product-info-RJ01014447-RJ99999999.json'), 'utf8');
const realEntry = (JSON.parse(FIXTURE) as Record<string, unknown>)['RJ01014447'];

describe('intIn', () => {
  const s = intIn(0, 100);
  it.each([
    [0, 0],
    [100, 100],
    ['30', 30],
    ['000000030', 30],
  ])('accepts %j', (v, out) => {
    expect(s.parse(v)).toBe(out);
  });
  it.each([
    -1,
    101,
    1.5,
    '101',
    '-1',
    '1.5',
    '1e2',
    ' 30',
    '30 ',
    '',
    '0x10',
    '1234567890', // 10 碼：字串分支限 9 碼
    '9'.repeat(400), // 不能變成 Infinity
    null,
    undefined,
    true,
    false,
    [],
    {},
    NaN,
    Infinity,
  ])('rejects %j', (v) => {
    expect(s.safeParse(v).success).toBe(false);
  });
  it('allows the full 1,000,000 price range', () => {
    expect(intIn(0, 1_000_000).parse('1000000')).toBe(1_000_000);
    expect(intIn(0, 1_000_000).safeParse(1_000_001).success).toBe(false);
  });
});

describe('optionalText', () => {
  it('turns empty / blank / null / missing into undefined', () => {
    const s = optionalText(10);
    for (const v of ['', '   ', '　', null, undefined]) expect(s.parse(v)).toBeUndefined();
    expect(s.parse(' t825ai ')).toBe('t825ai');
    expect(s.safeParse('x'.repeat(11)).success).toBe(false);
    expect(s.safeParse(1).success).toBe(false);
  });
});

describe('truncateChars', () => {
  it('does not split surrogate pairs', () => {
    expect(truncateChars('😀😀😀', 2)).toBe('😀😀');
    expect(truncateChars('abc', 5)).toBe('abc');
  });
});

describe('parseProductInfoResponse', () => {
  it('parses the real response (2026-11-23)', () => {
    const r = parseProductInfoResponse(FIXTURE, ['RJ01014447', 'RJ99999999']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.invalid).toEqual([]);
    expect(r.missing).toEqual([]);
    const a = r.found.get('RJ01014447')!;
    expect(a.imageUrl).toBe('https://img.dlsite.jp/modpub/images2/work/doujin/RJ01015000/RJ01014447_img_main.jpg');
    expect(a.siteId).toBe('home');
    expect(a.entry).toMatchObject({
      price: 1386,
      official_price: 1980,
      discount_rate: 30,
      is_discount: true,
      discount_end_date: '11/26 13:59',
      campaign_id: 't825ai',
      default_point_rate: 6,
      work_type: 'SOU',
      is_noreduction: false,
    });
    // 沒有打折的作品：discount_rate、campaign_id、discount_end_date 不出現；圖片不是 img.dlsite.jp → 空字串
    const b = r.found.get('RJ99999999')!;
    expect(b.imageUrl).toBe('');
    expect(b.entry.campaign_id).toBeUndefined();
    expect(b.entry.discount_end_date).toBeUndefined();
    expect(b.entry.discount_rate).toBeUndefined();
  });

  it('only keeps requested, valid ids', () => {
    const r = parseProductInfoResponse(FIXTURE, ['RJ01014447']);
    expect(r.ok && [...r.found.keys()]).toEqual(['RJ01014447']);
  });

  it('treats [] as "none of the ids exist" (measured 2026-11-23)', () => {
    const r = parseProductInfoResponse('[]', ['RJ00000001']);
    expect(r).toEqual({ ok: true, found: new Map(), missing: ['RJ00000001'], invalid: [] });
  });

  it('reports ids missing from the response', () => {
    const r = parseProductInfoResponse(JSON.stringify({ RJ01014447: realEntry }), ['RJ01014447', 'RJ00000001']);
    expect(r.ok && r.missing).toEqual(['RJ00000001']);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('ignores the %s key without touching prototypes', (key) => {
    const text = `{"${key}":{"polluted":true,"price":1},"RJ01014447":${JSON.stringify(realEntry)}}`;
    const r = parseProductInfoResponse(text, ['RJ01014447', key]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.found.keys()]).toEqual(['RJ01014447']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(r.found.has(key)).toBe(false);
  });

  it('isolates one bad entry from the rest', () => {
    const bad = { ...(realEntry as object), price: '¥1,386' };
    const r = parseProductInfoResponse(JSON.stringify({ RJ01014447: realEntry, RJ123456: bad }), ['RJ01014447', 'RJ123456']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.found.keys()]).toEqual(['RJ01014447']);
    expect(r.invalid).toEqual([{ id: 'RJ123456', path: 'price', code: expect.any(String) }]);
    expect(r.missing).toEqual([]);
    // 錯誤不含原始值（§3.3）
    expect(JSON.stringify(r.invalid)).not.toContain('1,386');
  });

  it('rejects non-object roots', () => {
    expect(parseProductInfoResponse('<!DOCTYPE html>', ['RJ01014447'])).toEqual({ ok: false, reason: 'unparsable' });
    expect(parseProductInfoResponse('null', ['RJ01014447'])).toEqual({ ok: false, reason: 'notObject' });
    expect(parseProductInfoResponse('"x"', ['RJ01014447'])).toEqual({ ok: false, reason: 'notObject' });
    expect(parseProductInfoResponse('[1]', ['RJ01014447'])).toEqual({ ok: false, reason: 'notObject' });
  });

  it('truncates long titles to 300 characters', () => {
    const e = { ...(realEntry as object), work_name: '😀'.repeat(400) };
    const r = parseProductInfoResponse(JSON.stringify({ RJ01014447: e }), ['RJ01014447']);
    expect(r.ok && Array.from(r.found.get('RJ01014447')!.title).length).toBe(300);
  });

  it('rejects empty-string campaign ids as undefined, not ""', () => {
    const e = { ...(realEntry as object), campaign_id: '  ', discount_end_date: '' };
    const r = parseProductInfoResponse(JSON.stringify({ RJ01014447: e }), ['RJ01014447']);
    expect(r.ok && r.found.get('RJ01014447')!.entry.campaign_id).toBeUndefined();
    expect(r.ok && r.found.get('RJ01014447')!.entry.discount_end_date).toBeUndefined();
  });
});

describe('toSnapshot', () => {
  const parsed = parseProductInfoResponse(FIXTURE, ['RJ01014447', 'RJ99999999']);
  if (!parsed.ok) throw new Error('fixture');
  const info = parsed.found.get('RJ01014447')!;

  it('builds a snapshot with the year resolved (§5.5)', () => {
    const s = toSnapshot(info, undefined, '2026-11-23T06:00:00.000Z')!;
    expect(s).toEqual({
      id: 'RJ01014447',
      available: true,
      price: 1386,
      officialPrice: 1980,
      isDiscount: true,
      discountRate: 30,
      discountEnd: '2026-11-26T04:59:00.000Z',
      campaignId: 't825ai',
      pointRate: 6,
      couponFacts: { siteId: 'home', workType: 'SOU', customGenres: expect.any(Array), noReduction: false },
      checkedAt: '2026-11-23T06:00:00.000Z',
    });
  });

  it('sold out keeps previous prices; without previous data writes nothing (§5.3)', () => {
    const soldOut = { ...info, entry: { ...info.entry, is_sold_out: true, price: 1 } };
    expect(toSnapshot(soldOut, undefined, '2026-11-23T06:00:00.000Z')).toBeUndefined();
    const prev = toSnapshot(info, undefined, '2026-11-23T06:00:00.000Z')!;
    const s = toSnapshot(soldOut, prev, '2026-11-23T12:00:00.000Z')!;
    expect(s.available).toBe(false);
    expect(s.price).toBe(1386);
    expect(s.checkedAt).toBe('2026-11-23T12:00:00.000Z');
    expect(unavailableSnapshot(undefined, '2026-11-23T12:00:00.000Z')).toBeUndefined();
  });
});
