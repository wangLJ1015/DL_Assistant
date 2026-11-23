import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setRuntimeEnvForTest, apiGet, assertAllowed, describeEndpoints, ENDPOINT_KEYS, type RuntimeEnv } from '../src/lib/api/endpoints';

const SW_ENV: RuntimeEnv = { isServiceWorker: true, locationOrigin: 'chrome-extension://abc', locationProtocol: 'chrome-extension:' };
const PAGE_ENV: RuntimeEnv = { isServiceWorker: false, locationOrigin: 'https://www.dlsite.com', locationProtocol: 'https:' };
const EXT_PAGE_ENV: RuntimeEnv = {
  isServiceWorker: false,
  locationOrigin: 'chrome-extension://abc',
  locationProtocol: 'chrome-extension:',
};

afterEach(() => {
  __setRuntimeEnvForTest(null);
  vi.unstubAllGlobals();
});

describe('endpoint whitelist', () => {
  it('is locked by snapshot (adding an endpoint must update this test)', () => {
    expect(ENDPOINT_KEYS).toEqual(['productInfo', 'couponList', 'dlwatcher']);
    expect(describeEndpoints()).toMatchSnapshot();
  });
});

describe('assertAllowed: behaviour', () => {
  const PRODUCT = 'https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ01014447&cdn_cache_min=1';

  it.each([
    'https://www.dlsite.com/home/mypage/coupon',
    'https://www.dlsite.com/home/mypage/coupon?x=1',
    'https://www.dlsite.com/home/mypage/coupon/',
    'https://www.dlsite.com/home/mypage/coupon/list',
    'https://www.dlsite.com/home/cart',
    'https://www.dlsite.com/home/buy',
    'https://login.dlsite.com/',
    'https://www.dlsite.com/home/mypage/coupon/list/ajax/',
    'https://www.dlsite.com/home/mypage/coupon/list/ajax?x=1',
    'https://www.dlsite.com/home/mypage/coupon/list/ajax#x',
    'https://www.dlsite.com/home/mypage/coupon/list/ajax#',
    'https://user:pw@www.dlsite.com/home/mypage/coupon/list/ajax',
    'http://www.dlsite.com/home/mypage/coupon/list/ajax',
    'https://www.dlsite.com.evil.example/home/mypage/coupon/list/ajax',
    'https://www.dlsite.com/home/mypage/coupon/list/ajax/../../../mypage/coupon',
  ])('couponList rejects %s', (url) => {
    expect(() => assertAllowed('couponList', url)).toThrow();
  });

  it('couponList accepts the exact url', () => {
    expect(() => assertAllowed('couponList', 'https://www.dlsite.com/home/mypage/coupon/list/ajax')).not.toThrow();
  });

  it.each([
    'https://www.dlsite.com/home/mypage/coupon',
    'https://www.dlsite.com/home/cart',
    'https://login.dlsite.com/',
    'https://www.dlsite.com/maniax/product/info/ajax', // 沒有參數
    'https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ01014447', // 少了 cdn_cache_min
    'https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ01014447&cdn_cache_min=2',
    'https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ1&cdn_cache_min=1', // 非法編號
    'https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ01014447,__proto__&cdn_cache_min=1',
    'https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ01014447,RJ01014447&cdn_cache_min=1', // 重複編號
    'https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ01014447&product_id=RJ123456&cdn_cache_min=1', // 重複參數
    'https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ01014447&cdn_cache_min=1&cdn_cache_min=1',
    'https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ01014447&cdn_cache_min=1&x=1',
    'https://www.dlsite.com/maniax/product/info/ajax?product_id=&cdn_cache_min=1',
    `${PRODUCT}#hash`,
    `${PRODUCT}#`,
    'https://www.dlsite.com/maniax/product/info/ajax/?product_id=RJ01014447&cdn_cache_min=1',
    'https://www.dlsite.com/home/product/info/ajax?product_id=RJ01014447&cdn_cache_min=1',
    'https://a:b@www.dlsite.com/maniax/product/info/ajax?product_id=RJ01014447&cdn_cache_min=1',
  ])('productInfo rejects %s', (url) => {
    expect(() => assertAllowed('productInfo', url)).toThrow();
  });

  it('productInfo rejects more than 100 ids', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `RJ${String(i).padStart(8, '0')}`);
    expect(() =>
      assertAllowed('productInfo', `https://www.dlsite.com/maniax/product/info/ajax?product_id=${ids.join(',')}&cdn_cache_min=1`),
    ).toThrow();
    expect(() =>
      assertAllowed(
        'productInfo',
        `https://www.dlsite.com/maniax/product/info/ajax?product_id=${ids.slice(0, 100).join('%2C')}&cdn_cache_min=1`,
      ),
    ).not.toThrow();
  });

  it('productInfo accepts both raw and %2C-encoded commas', () => {
    expect(() => assertAllowed('productInfo', PRODUCT)).not.toThrow();
    expect(() =>
      assertAllowed('productInfo', 'https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ01014447%2CRJ123456&cdn_cache_min=1'),
    ).not.toThrow();
  });

  it.each([
    'https://dlwatcher.com/product/RJ1.json',
    'https://dlwatcher.com/product/RJ01014447.json?x=1',
    'https://dlwatcher.com/product/RJ01014447.json#x',
    'https://dlwatcher.com/product/RJ01014447.jsonx',
    'https://dlwatcher.com/product/RJ01014447.json/',
    'https://dlwatcher.com/x/product/RJ01014447.json',
    'https://dlwatcher.com.evil.example/product/RJ01014447.json',
    'http://dlwatcher.com/product/RJ01014447.json',
    'https://www.dlsite.com/product/RJ01014447.json',
  ])('dlwatcher rejects %s', (url) => {
    expect(() => assertAllowed('dlwatcher', url)).toThrow();
  });

  it('dlwatcher accepts a work json', () => {
    expect(() => assertAllowed('dlwatcher', 'https://dlwatcher.com/product/RJ01014447.json')).not.toThrow();
  });
});

describe('apiGet', () => {
  const okFetch = () => vi.fn(async () => new Response('{}', { status: 200 }));

  it('productInfo only runs in the service worker', async () => {
    vi.stubGlobal('fetch', okFetch());
    __setRuntimeEnvForTest(() => PAGE_ENV);
    await expect(apiGet('productInfo', { ids: ['RJ01014447'] })).rejects.toThrow();
    __setRuntimeEnvForTest(() => EXT_PAGE_ENV);
    await expect(apiGet('productInfo', { ids: ['RJ01014447'] })).rejects.toThrow();
    __setRuntimeEnvForTest(() => ({ ...SW_ENV, locationProtocol: 'https:' }));
    await expect(apiGet('productInfo', { ids: ['RJ01014447'] })).rejects.toThrow();
  });

  it('couponList only runs on a DLsite page', async () => {
    vi.stubGlobal('fetch', okFetch());
    __setRuntimeEnvForTest(() => SW_ENV);
    await expect(apiGet('couponList', {})).rejects.toThrow();
    __setRuntimeEnvForTest(() => ({ ...PAGE_ENV, locationOrigin: 'https://www.dlsite.com.evil.example' }));
    await expect(apiGet('couponList', {})).rejects.toThrow();
  });

  it('dlwatcher only runs in the service worker and validates the id', async () => {
    vi.stubGlobal('fetch', okFetch());
    __setRuntimeEnvForTest(() => PAGE_ENV);
    await expect(apiGet('dlwatcher', { id: 'RJ01014447' })).rejects.toThrow();
    __setRuntimeEnvForTest(() => SW_ENV);
    await expect(apiGet('dlwatcher', { id: '../../x' })).rejects.toThrow();
  });

  it('sends the fixed fetch options per endpoint', async () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    __setRuntimeEnvForTest(() => SW_ENV);
    await apiGet('productInfo', { ids: ['RJ01014447', 'RJ123456'] });
    await apiGet('dlwatcher', { id: 'RJ01014447' });
    __setRuntimeEnvForTest(() => PAGE_ENV);
    await apiGet('couponList', {});
    expect(f.mock.calls).toEqual([
      [
        'https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ01014447%2CRJ123456&cdn_cache_min=1',
        { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' },
      ],
      [
        'https://dlwatcher.com/product/RJ01014447.json',
        { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' },
      ],
      [
        'https://www.dlsite.com/home/mypage/coupon/list/ajax',
        { method: 'GET', credentials: 'same-origin', redirect: 'manual', cache: 'no-store', mode: 'same-origin' },
      ],
    ]);
  });

  it('rejects invalid product ids before fetching', async () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    __setRuntimeEnvForTest(() => SW_ENV);
    await expect(apiGet('productInfo', { ids: ['RJ01014447', 'RJ01014447'] })).rejects.toThrow();
    await expect(apiGet('productInfo', { ids: [] })).rejects.toThrow();
    await expect(apiGet('productInfo', { ids: ['RJ01014447&x=1'] })).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it('maps failures', async () => {
    __setRuntimeEnvForTest(() => SW_ENV);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 503 })),
    );
    expect(await apiGet('productInfo', { ids: ['RJ01014447'] })).toEqual({ ok: false, kind: 'http', status: 503 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('net'))),
    );
    expect(await apiGet('productInfo', { ids: ['RJ01014447'] })).toEqual({ ok: false, kind: 'network' });
  });

  it('aborts bodies over the size limit (DLsite 5 MB)', async () => {
    __setRuntimeEnvForTest(() => SW_ENV);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(big, { status: 200 })),
    );
    expect(await apiGet('productInfo', { ids: ['RJ01014447'] })).toEqual({ ok: false, kind: 'tooLarge' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-length': String(6 * 1024 * 1024) } })),
    );
    expect(await apiGet('productInfo', { ids: ['RJ01014447'] })).toEqual({ ok: false, kind: 'tooLarge' });
  });

  it('returns the text on success', async () => {
    __setRuntimeEnvForTest(() => SW_ENV);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"a":1}', { status: 200 })),
    );
    expect(await apiGet('productInfo', { ids: ['RJ01014447'] })).toEqual({ ok: true, status: 200, text: '{"a":1}' });
  });
});
