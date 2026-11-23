import { describe, expect, it } from 'vitest';
import { __regexForTest, buildWorkUrl, isWorkId, normalizeImageUrl, normalizeSite, SITES, workIdFromUrl } from '../src/lib/ids';

describe('isWorkId', () => {
  it.each(['RJ123456', 'RJ01014447', 'RE01234567', 'BJ123456', 'VJ01234567'])('accepts %s', (id) => {
    expect(isWorkId(id)).toBe(true);
  });
  it.each([
    'RJ1234567', // 7 碼
    'RJ012345678', // 9 碼
    'RJ12345',
    'rj123456',
    'XX123456',
    ' RJ123456',
    'RJ123456 ',
    'RJ123456\n',
    'xRJ123456',
    '__proto__',
    '',
    'ＲＪ123456',
  ])('rejects %j', (id) => {
    expect(isWorkId(id)).toBe(false);
  });
  it('rejects non-strings', () => {
    for (const v of [123456, null, undefined, {}, ['RJ123456']]) expect(isWorkId(v)).toBe(false);
  });
});

describe('buildWorkUrl', () => {
  const FORBIDDEN = [/\/mypage\/coupon/, /\/cart/, /\/buy/, /\/mypage/, /login/, /\/account/];

  it.each(SITES)('site %s produces a work page url only', (site) => {
    const url = buildWorkUrl(site, 'RJ01014447');
    expect(url).toBe(`https://www.dlsite.com/${site}/work/=/product_id/RJ01014447.html`);
    const u = new URL(url);
    expect(u.origin).toBe('https://www.dlsite.com');
    for (const f of FORBIDDEN) expect(url).not.toMatch(f);
  });

  it('falls back to maniax for unknown sites', () => {
    for (const s of ['comic', '../home/mypage/coupon', 'home/mypage', '', 'HOME', '__proto__', 1, null]) {
      expect(buildWorkUrl(s, 'RJ01014447')).toBe('https://www.dlsite.com/maniax/work/=/product_id/RJ01014447.html');
    }
    expect(normalizeSite('constructor')).toBe('maniax');
  });

  it('throws on invalid ids', () => {
    for (const id of ['RJ1', '../mypage/coupon', 'RJ01014447/../../mypage/coupon', 'RJ01014447?x=1']) {
      expect(() => buildWorkUrl('home', id)).toThrow();
    }
  });
});

describe('workIdFromUrl', () => {
  it.each([
    ['https://www.dlsite.com/maniax/work/=/product_id/RJ01014447.html', 'RJ01014447'],
    ['https://www.dlsite.com/home/work/=/product_id/RJ123456.html', 'RJ123456'],
    ['https://www.dlsite.com/home/announce/=/product_id/RJ01014447.html', 'RJ01014447'],
    ['https://www.dlsite.com/girls-pro/work/=/product_id/VJ01014447.html', 'VJ01014447'],
    ['https://www.dlsite.com/home/work/=/product_id/RJ01014447.html/?locale=ja_JP', 'RJ01014447'],
    ['https://www.dlsite.com/home/work/=/product_id/RJ01014447', 'RJ01014447'],
    ['https://www.dlsite.com/home/work/=/product_id/RJ01014447.html#top', 'RJ01014447'],
  ])('%s → %s', (url, id) => {
    expect(workIdFromUrl(url)).toBe(id);
  });

  it.each([
    'http://www.dlsite.com/home/work/=/product_id/RJ01014447.html',
    'https://dlsite.com/home/work/=/product_id/RJ01014447.html',
    'https://www.dlsite.com.evil.example/home/work/=/product_id/RJ01014447.html',
    'https://user:pw@www.dlsite.com/home/work/=/product_id/RJ01014447.html',
    'https://www.dlsite.com/home/work/=/product_id/RJ0101444.html', // 7 碼
    'https://www.dlsite.com/home/work/=/product_id/RJ010144478.html', // 9 碼
    'https://www.dlsite.com/home/work/=/product_id/RJ01014447x.html',
    'https://www.dlsite.com/x/home/work/=/product_id/RJ01014447.html',
    'https://www.dlsite.com/home/mypage/coupon',
    'not a url',
    'javascript:alert(1)',
  ])('rejects %s', (url) => {
    expect(workIdFromUrl(url)).toBeUndefined();
  });
});

describe('normalizeImageUrl', () => {
  it('adds https: to protocol-relative urls', () => {
    expect(normalizeImageUrl('//img.dlsite.jp/modpub/images2/work/doujin/RJ01015000/RJ01014447_img_main.jpg')).toBe(
      'https://img.dlsite.jp/modpub/images2/work/doujin/RJ01015000/RJ01014447_img_main.jpg',
    );
  });
  it.each([
    '//www.dlsite.com/images/web/home/no_img_main.gif', // 實測：沒有圖的作品
    'http://img.dlsite.jp/a.jpg',
    'https://img.dlsite.jp.evil.example/a.jpg',
    'https://user@img.dlsite.jp/a.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '/a.jpg',
    '',
  ])('rejects %s', (raw) => {
    expect(normalizeImageUrl(raw)).toBe('');
  });
});

describe('§3.2.6 regex ReDoS', () => {
  const evil = [
    'R'.repeat(100_000),
    'RJ' + '1'.repeat(100_000),
    '/a/work/=/product_id/' + 'A'.repeat(100_000),
    '/' + 'a-'.repeat(50_000),
    '/a/work/=/product_id/RJ' + '1'.repeat(100_000) + '!',
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
