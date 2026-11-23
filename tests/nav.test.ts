import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { extPageUrl, NAV_URLS } from '../src/lib/nav';

const FORBIDDEN = [/\/mypage\/coupon/, /\/cart/, /\/buy/, /\/mypage/, /login\./];

describe('nav.ts', () => {
  it('constants never point at account, cart-add, coupon or buy paths', () => {
    for (const url of Object.values(NAV_URLS) as string[]) {
      for (const f of FORBIDDEN) expect(url).not.toMatch(f);
    }
  });

  it('builds extension page urls from runtime.getURL', () => {
    const base = fakeBrowser.runtime.getURL('/');
    expect(extPageUrl('dashboard')).toBe(`${base}dashboard.html`);
    expect(extPageUrl('lookup', { id: 'RJ01014447' })).toBe(`${base}lookup.html?id=RJ01014447`);
    expect(extPageUrl('dashboard', { n: 'abc' })).toBe(`${base}dashboard.html?n=abc`);
  });

  it('validates parameters', () => {
    expect(() => extPageUrl('lookup')).toThrow();
    expect(() => extPageUrl('lookup', { id: 'https://evil.example/' })).toThrow();
    expect(() => extPageUrl('dashboard', { id: 'RJ01014447' })).toThrow();
    expect(() => extPageUrl('dashboard', { n: 'x'.repeat(65) })).toThrow();
    expect(() => extPageUrl('planner', { n: 'x' })).toThrow();
  });
});
