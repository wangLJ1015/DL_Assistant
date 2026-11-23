import { describe, expect, it } from 'vitest';
import { cartIdFromEvent, cartIdFromTarget, readCartIds, type ElementLike } from '../src/content/cart';
import { __regexForTest, isCartPageUrl, workIdFromCartHref } from '../src/lib/selectors';

const WORK_PAGE = 'https://www.dlsite.com/home/work/=/product_id/RJ01014447.html';
const LIST_PAGE = 'https://www.dlsite.com/home/ranking/week';

/**
 * 只實作用到的 DOM 成員。`selectors` 是這個元素符合的選擇器（逐字比對整串選擇器），
 * `descendants` 是子孫元素的數量。
 */
function el(attrs: Record<string, string>, selectors: string[] = [], parent: ElementLike | null = null, descendants = 0): ElementLike {
  return {
    getAttribute: (n) => (Object.hasOwn(attrs, n) ? attrs[n]! : null),
    matches: (s) => selectors.includes(s),
    parentElement: parent,
    querySelectorAll: () => ({ length: descendants }),
  };
}

const LINK = 'a.btn_cart[href]';
const PAGE_BUTTON = 'button.btn_cart[data-ga4-ref="cart_add"]';

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
  it('reads the id from a list-page link href, also when a child of the link is clicked', () => {
    const a = el({ href: '/home/cart/=/product_id/RJ01760999.html' }, [LINK]);
    expect(cartIdFromTarget(a, 'RJ01014447', WORK_PAGE)).toBe('RJ01760999');
    expect(cartIdFromTarget(el({}, [], a), 'RJ01014447', WORK_PAGE)).toBe('RJ01760999');
  });

  it('uses the page id only for the work page own <button>', () => {
    const button = el({ 'data-ga4-ref': 'cart_add' }, [PAGE_BUTTON]);
    expect(cartIdFromTarget(button, 'RJ01014447', WORK_PAGE)).toBe('RJ01014447');
    expect(cartIdFromTarget(el({}, [], button, 0), 'RJ01014447', WORK_PAGE)).toBe('RJ01014447');
    expect(cartIdFromTarget(button, undefined, LIST_PAGE)).toBeUndefined();
  });

  it('never reads an href from the page button', () => {
    // 頁面把 href 加到 <button> 上：仍然只用頁面編號
    const button = el({ 'data-ga4-ref': 'cart_add', href: '/home/cart/=/product_id/RJ66666666.html' }, [PAGE_BUTTON]);
    expect(cartIdFromTarget(button, 'RJ01014447', WORK_PAGE)).toBe('RJ01014447');
    expect(cartIdFromTarget(button, undefined, LIST_PAGE)).toBeUndefined();
  });

  it('gives up instead of guessing', () => {
    // a.btn_cart 的 href 不是加入購物車的路徑（作品頁網址、站外網址）
    expect(
      cartIdFromTarget(el({ href: 'https://www.dlsite.com/home/work/=/product_id/RJ01760999.html' }, [LINK]), undefined, LIST_PAGE),
    ).toBeUndefined();
    expect(
      cartIdFromTarget(el({ href: 'https://evil.example/home/cart/=/product_id/RJ01760999.html' }, [LINK]), 'RJ01014447', WORK_PAGE),
    ).toBeUndefined();
    expect(cartIdFromTarget(el({ href: '/home/cart/=/product_id/RJ' + '1'.repeat(3000) }, [LINK]), undefined, LIST_PAGE)).toBeUndefined();
    // 不是購物車按鈕
    expect(cartIdFromTarget(el({ href: '/home/cart/=/product_id/RJ01760999.html' }), 'RJ01014447', WORK_PAGE)).toBeUndefined();
  });

  it('only looks a few levels up from the click target (M2 review: page wrapped in a cart link)', () => {
    const wrapper = el({ href: '/home/cart/=/product_id/RJ66666666.html' }, [LINK]);
    let t: ElementLike = wrapper;
    for (let i = 0; i < 3; i++) t = el({}, [], t);
    expect(cartIdFromTarget(t, undefined, LIST_PAGE)).toBe('RJ66666666'); // 3 層內
    expect(cartIdFromTarget(el({}, [], t), undefined, LIST_PAGE)).toBeUndefined(); // 4 層
  });

  it('rejects a "button" that contains many elements (M2 review: <html> turned into a cart button)', () => {
    const html = el({ href: '/home/cart/=/product_id/RJ66666666.html', 'data-ga4-ref': 'cart_add' }, [LINK], null, 500);
    expect(cartIdFromTarget(el({}, [], html), undefined, LIST_PAGE)).toBeUndefined();
    const page = el({ 'data-ga4-ref': 'cart_add' }, [PAGE_BUTTON], null, 6);
    expect(cartIdFromTarget(page, 'RJ01014447', WORK_PAGE)).toBeUndefined();
    expect(cartIdFromTarget(el({ 'data-ga4-ref': 'cart_add' }, [PAGE_BUTTON], null, 5), 'RJ01014447', WORK_PAGE)).toBe('RJ01014447');
  });
});

describe('F1 click events (§3.2.4)', () => {
  const target = el({ href: '/home/cart/=/product_id/RJ01760999.html' }, [LINK]);
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
    expect(cartIdFromEvent({ isTrusted: true, type: 'click', button: 0, target: { matches: 1 } }, undefined, LIST_PAGE)).toBeUndefined();
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
