import { describe, expect, it } from 'vitest';
import { __regexForTest, isCanonicalIso, parseJst, resolveDiscountEnd, unixSecondsToIso } from '../src/lib/dates';
import { unixSecondsSchema } from '../src/lib/schema';

// JST 的時間 → UTC ISO（測試用的小工具）
const jst = (s: string) => parseJst(s)!;

describe('§5.5 parseJst', () => {
  it('runs in Asia/Taipei for these tests', () => {
    expect(process.env.TZ).toBe('Asia/Taipei');
  });
  it('parses as JST regardless of local time zone', () => {
    expect(parseJst('2026-11-28 23:59:59')).toBe('2026-11-28T14:59:59.000Z');
  });
  it.each([
    '2026-02-30 00:00:00',
    '2026-11-28 24:00:00',
    '2026-11-28 23:60:00',
    '2026-13-01 00:00:00',
    '2026-11-28T23:59:59',
    '2026-11-28 23:59',
    ' 2026-11-28 23:59:59',
  ])('rejects %s', (s) => {
    expect(parseJst(s)).toBeNull();
  });
});

describe('§5.5 resolveDiscountEnd', () => {
  it.each([
    ['2026-12-30 12:00:00', '12/31 23:59', '2026-12-31 23:59:00'],
    ['2026-12-30 12:00:00', '01/02 23:59', '2027-01-02 23:59:00'],
    ['2027-01-01 00:30:00', '12/31 23:59', '2026-12-31 23:59:00'], // CDN 快取的舊資料（已結束）
    ['2026-11-23 12:00:00', '11/20 13:59', '2026-11-20 13:59:00'], // 已結束
    ['2027-12-20 12:00:00', '02/29 23:59', '2028-02-29 23:59:00'],
  ])('checked at JST %s, sees %s → %s', (checked, raw, want) => {
    expect(resolveDiscountEnd(raw, jst(checked))).toEqual({ kind: 'known', iso: jst(want) });
  });

  it('2027-03-01 sees 02/29 → unknown', () => {
    expect(resolveDiscountEnd('02/29 23:59', jst('2027-03-01 12:00:00'))).toEqual({ kind: 'unknown', stale: false });
  });

  it('2026-06-01 sees 12/15 (197 days later) → unknown', () => {
    expect(resolveDiscountEnd('12/15 23:59', jst('2026-06-01 12:00:00')).kind).toBe('unknown');
  });

  it('more than 7 days in the past → unknown and stale', () => {
    expect(resolveDiscountEnd('11/10 13:59', jst('2026-11-23 12:00:00'))).toEqual({ kind: 'unknown', stale: true });
  });

  it('accepts the full format via parseJst', () => {
    expect(resolveDiscountEnd('2026-11-26 13:59:00', jst('2026-11-23 12:00:00'))).toEqual({
      kind: 'known',
      iso: '2026-11-26T04:59:00.000Z',
    });
  });

  it.each(['13/01 00:00', '11/26 24:00', '1/2 3:4', '', 'x'])('rejects malformed %j', (raw) => {
    expect(resolveDiscountEnd(raw, jst('2026-11-23 12:00:00')).kind).toBe('unknown');
  });
});

describe('§5.5 limit_date', () => {
  it('converts seconds to ISO', () => {
    expect(unixSecondsToIso(unixSecondsSchema.parse(1796227116))).toBe('2026-12-02T15:58:36.000Z');
  });
  it.each([1796227116000, 1796227116.5, 946684799, 4102444801, '1796227116', null])('rejects %j', (v) => {
    expect(unixSecondsSchema.safeParse(v).success).toBe(false);
  });
});

describe('§3.2.6 ReDoS', () => {
  const evil = [
    '1'.repeat(100_000),
    '2026-11-28 ' + '1'.repeat(100_000),
    '11/' + '2'.repeat(100_000) + ' 00:00',
    '2026-12-02T15:58:36.' + '0'.repeat(100_000) + 'Z',
    '-/: T.Z'.repeat(15_000),
  ];
  for (const [name, re] of Object.entries(__regexForTest)) {
    it(`${name} finishes within 50ms on 100k-char input`, () => {
      for (const s of evil) {
        const t0 = performance.now();
        re.test(s);
        expect(performance.now() - t0).toBeLessThan(50);
      }
    });
  }
});

describe('isCanonicalIso', () => {
  it.each(['2026-12-02T15:58:36.000Z'])('accepts %s', (s) => expect(isCanonicalIso(s)).toBe(true));
  it.each(['2026-12-02T15:58:36Z', '2026-02-30T00:00:00.000Z', '2026-12-02 15:58:36.000Z', '2026-12-02T15:58:36.000+09:00', ''])(
    'rejects %s',
    (s) => expect(isCanonicalIso(s)).toBe(false),
  );
});
