// F1／F2：加入購物車偵測與購物車同步（§2）。只讀選擇器取到的元素的屬性，不讀頁面文字（§3.2.6）。
import { isWorkId } from '../lib/ids';
import {
  CART_BUTTON_MAX_DEPTH,
  CART_BUTTON_MAX_DESCENDANTS,
  CART_ITEM_ID_ATTR,
  CART_ITEM_SELECTOR,
  CART_LIST_SELECTOR,
  LINK_CART_BUTTON_SELECTOR,
  PAGE_CART_BUTTON_SELECTOR,
  workIdFromCartHref,
} from '../lib/selectors';

/** cartSnapshot 一次最多送的編號數（§3.2.4，background 也會檢查）。 */
export const MAX_CART_SNAPSHOT = 200;
const MAX_HREF_LENGTH = 2000;

/** 只需要 DOM 的這幾個成員，方便單元測試用假物件。 */
export interface ElementLike {
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
  readonly parentElement: ElementLike | null;
  querySelectorAll(selector: string): { readonly length: number };
}

/**
 * 點擊目標 → 加入購物車按鈕 → 作品編號（F1）。
 * - 只往上找 CART_BUTTON_MAX_DEPTH 層，按鈕裡的子孫元素不能超過 CART_BUTTON_MAX_DESCENDANTS 個：
 *   頁面把整頁包進一個 a.btn_cart 時，點擊頁面其他地方不會被當成加入購物車。
 * - `a.btn_cart` 從 href 取編號（只接受加入購物車的路徑）；作品頁本身的 <button> 用文件載入時的頁面編號。
 * - 都取不到就放棄，不掃頁面文字。
 */
export function cartIdFromTarget(target: ElementLike, pageWorkId: string | undefined, pageUrl: string): string | undefined {
  let el: ElementLike | null = target;
  for (let depth = 0; el && depth <= CART_BUTTON_MAX_DEPTH; depth++, el = el.parentElement) {
    const isLink = el.matches(LINK_CART_BUTTON_SELECTOR);
    const isPageButton = !isLink && el.matches(PAGE_CART_BUTTON_SELECTOR);
    if (!isLink && !isPageButton) continue;
    if (el.querySelectorAll('*').length > CART_BUTTON_MAX_DESCENDANTS) return undefined;
    if (isPageButton) return pageWorkId;
    const href = el.getAttribute('href') ?? '';
    return href.length <= MAX_HREF_LENGTH ? workIdFromCartHref(href, pageUrl) : undefined;
  }
  return undefined;
}

/** 點擊事件需要的欄位（MouseEvent 的子集，方便測試）。 */
export interface ClickLike {
  isTrusted: boolean;
  type: string;
  button: number;
  target: unknown;
}

function isElementLike(t: unknown): t is ElementLike {
  return typeof t === 'object' && t !== null && typeof (t as ElementLike).matches === 'function';
}

/**
 * F1：點擊事件 → 要送 cartClicked 的作品編號。
 * 只處理使用者真的點擊（isTrusted，§3.2.4）；auxclick 只算中鍵（開新分頁），不算右鍵。
 */
export function cartIdFromEvent(e: ClickLike, pageWorkId: string | undefined, pageUrl: string): string | undefined {
  if (e.isTrusted !== true) return undefined;
  if (e.type === 'auxclick' && e.button !== 1) return undefined;
  if (!isElementLike(e.target)) return undefined;
  return cartIdFromTarget(e.target, pageWorkId, pageUrl);
}

/** 購物車頁的作品編號（F2）：不合格的略過，去掉重複，最多 200 件。 */
export function readCartIds(items: Iterable<Pick<ElementLike, 'getAttribute'>>): string[] {
  const ids: string[] = [];
  for (const item of items) {
    const id = item.getAttribute(CART_ITEM_ID_ATTR);
    if (isWorkId(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_CART_SNAPSHOT) break;
  }
  return ids;
}

export { CART_ITEM_SELECTOR, CART_LIST_SELECTOR };
