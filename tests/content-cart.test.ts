import { describe, expect, it } from 'vitest';
import { cartIdFromEvent, cartIdFromTarget, readCartIds, type ElementLike } from '../src/content/cart';
import { __regexForTest, isCartPageUrl, workIdFromCartHref } from '../src/lib/selectors';

const WORK_PAGE = 'https://www.dlsite.com/home/work/=/product_id/RJ01014447.html';
const LIST_PAGE = 'https://www.dlsite.com/home/ranking/week';

/** 只實作用到的 DOM 方法。`selectors` 是這個元素符合的選擇器（逐字比對整串選擇器）。 */
function el(attrs: Record<string, string>, selectors: string[] = [], parent: ElementLike | null = null): ElementLike {
  const self: ElementLike = {
    getAttribute: (n) => (Object.hasOwn(attrs, n) ? attrs[n]! : null),
    matches: (s) => selectors.includes(s),
    closest: (s) => (selectors.includes(s) ? self : (parent?.closest(s) ?? null)),
  };
  return self;
}

const CART_BUTTON = 'a.btn_cart, button.btn_cart, [data-ga4-ref="cart_add"]';
const PAGE_BUTTON = '[data-ga4-ref="cart_add"]';

describe('selectors (2026-11-23 DLsite)', () => {
  it.each([
    ['https://www.dlsite.com/home/cart/', true],
    ['https://www.dlsite.com/maniax/cart', true],
    ['https://www.dlsite.com/girls-pro/cart/', true],
    ['https://www.dlsite.com/home/cart/?locale=ja_JP', true],
    ['https://www.dlsite.com/home/cart/ajax/=/mode/cart_remove/product_id/RJ01014447.html', false],
    ['https://www.dlsite.com/home/cart/=/product_id/RJ01014447.html', false],
    ['http://www.dlsite.com/home/cart/', false],
    ['https://www.dlsite.com.evil.example/home/cart/', false],
    ['https://user:pw@www.dlsite.com/home/cart/', false],
    ['https://www.dlsite.com/home/work/=/product_id/RJ01014447.html', false],
    ['not a url', false],
  ])('isCartPageUrl(%s) = %s', (url, expected) => {
    expect(isCartPageUrl(url)).toBe(expected);
  });

  it.each([
    ['/home/cart/=/product_id/RJ01760999.html', 'RJ01760999'],
    ['https://www.dlsite.com/maniax/cart/=/product_id/RJ123456.html', 'RJ123456'],
    ['/bl-drama/cart/=/product_id/BJ01234567', 'BJ01234567'],
    ['/home/cart/=/product_id/RJ1234567.html', undefined], // 7 碼
    ['/home/cart/=/product_id/XX123456.html', undefined],
    ['/home/cart/ajax/=/mode/cart_remove/product_id/RJ01014447.html', undefined],
    ['https://evil.example/home/cart/=/product_id/RJ01760999.html', undefined],
    ['//evil.example/home/cart/=/product_id/RJ01760999.html', undefined],
    ['javascript:alert(1)', undefined],
  ])('workIdFromCartHref(%s) = %s', (href, expected) => {
    expect(workIdFromCartHref(href, LIST_PAGE)).toBe(expected);
  });

  for (const [name, re] of Object.entries(__regexForTest)) {
    it(`${name} finishes within 50ms on 100k-char input (§3.2.6)`, () => {
      for (const s of ['/' + 'a'.repeat(100_000), '/a-' + 'b-'.repeat(50_000), '/home/cart/=/product_id/RJ' + '1'.repeat(100_000)]) {
        const t0 = performance.now();
        re.test(s);
        expect(performance.now() - t0).toBeLessThan(50);
      }
    });
  }
});

describe('F1 cart button → work id', () => {
  it('reads the id from a list-page button href', () => {
    const a = el({ href: '/home/cart/=/product_id/RJ01760999.html', class: 'btn_cart' }, [CART_BUTTON]);
    // 點到按鈕裡的子元素也算
    const inner = el({}, [], a);
    expect(cartIdFromTarget(inner, 'RJ01014447', WORK_PAGE)).toBe('RJ01760999');
  });

  it('uses the page id only for the work page own button (no href)', () => {
    const button = el({ 'data-ga4-ref': 'cart_add' }, [CART_BUTTON, PAGE_BUTTON]);
    expect(cartIdFromTarget(button, 'RJ01014447', WORK_PAGE)).toBe('RJ01014447');
    expect(cartIdFromTarget(button, undefined, LIST_PAGE)).toBeUndefined();
  });

  it('gives up instead of guessing', () => {
    // 有 href 但不是加入購物車或作品頁的網址：不退回頁面網址
    const weird = el({ href: 'https://evil.example/x' }, [CART_BUTTON]);
    expect(cartIdFromTarget(weird, 'RJ01014447', WORK_PAGE)).toBeUndefined();
    // button.btn_cart 但不是作品頁本身的按鈕：沒有 href 也不用頁面網址
    const other = el({}, [CART_BUTTON]);
    expect(cartIdFromTarget(other, 'RJ01014447', WORK_PAGE)).toBeUndefined();
    // 不是購物車按鈕
    expect(cartIdFromTarget(el({ href: '/home/cart/=/product_id/RJ01760999.html' }), 'RJ01014447', WORK_PAGE)).toBeUndefined();
  });

  it('accepts a work-page href on a cart button', () => {
    const a = el({ href: 'https://www.dlsite.com/home/work/=/product_id/RJ01760999.html' }, [CART_BUTTON]);
    expect(cartIdFromTarget(a, undefined, LIST_PAGE)).toBe('RJ01760999');
  });
});

describe('F1 click events (§3.2.4)', () => {
  const target = el({ href: '/home/cart/=/product_id/RJ01760999.html' }, [CART_BUTTON]);
  it('only handles trusted clicks', () => {
    expect(cartIdFromEvent({ isTrusted: true, type: 'click', button: 0, target }, undefined, LIST_PAGE)).toBe('RJ01760999');
    expect(cartIdFromEvent({ isTrusted: false, type: 'click', button: 0, target }, undefined, LIST_PAGE)).toBeUndefined();
  });
  it('counts middle-click auxclick but not right-click', () => {
    expect(cartIdFromEvent({ isTrusted: true, type: 'auxclick', button: 1, target }, undefined, LIST_PAGE)).toBe('RJ01760999');
    expect(cartIdFromEvent({ isTrusted: true, type: 'auxclick', button: 2, target }, undefined, LIST_PAGE)).toBeUndefined();
  });
  it('ignores non-element targets', () => {
    expect(cartIdFromEvent({ isTrusted: true, type: 'click', button: 0, target: null }, undefined, LIST_PAGE)).toBeUndefined();
    expect(cartIdFromEvent({ isTrusted: true, type: 'click', button: 0, target: { closest: 1 } }, undefined, LIST_PAGE)).toBeUndefined();
  });
});

describe('F2 cart page ids', () => {
  it('keeps valid unique ids', () => {
    const items = ['RJ01014447', 'RJ01014447', '__proto__', '', 'RJ123456'].map((id) => el({ 'data-product-id': id }));
    items.push(el({}));
    expect(readCartIds(items)).toEqual(['RJ01014447', 'RJ123456']);
  });
  it('stops at 200', () => {
    const items = Array.from({ length: 250 }, (_, i) => el({ 'data-product-id': `RJ${String(i).padStart(8, '0')}` }));
    expect(readCartIds(items)).toHaveLength(200);
  });
});
