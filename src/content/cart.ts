// F1／F2：加入購物車偵測與購物車同步（§2）。只讀選擇器取到的元素的屬性，不讀頁面文字（§3.2.6）。
import { isWorkId, workIdFromUrl } from '../lib/ids';
import {
  CART_BUTTON_SELECTOR,
  CART_ITEM_ID_ATTR,
  CART_ITEM_SELECTOR,
  PAGE_CART_BUTTON_SELECTOR,
  workIdFromCartHref,
} from '../lib/selectors';

/** cartSnapshot 一次最多送的編號數（§3.2.4，background 也會檢查）。 */
export const MAX_CART_SNAPSHOT = 200;

/** 只需要 DOM 的這幾個方法，方便單元測試用假物件。 */
export interface ElementLike {
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
  closest(selector: string): ElementLike | null;
}

/**
 * 點擊目標 → 加入購物車按鈕 → 作品編號（F1）。
 * 編號優先從按鈕的 href 取；作品頁本身的按鈕沒有 href，才用文件載入時的頁面網址（pageWorkId）。都取不到就放棄。
 */
export function cartIdFromTarget(target: ElementLike, pageWorkId: string | undefined, pageUrl: string): string | undefined {
  const button = target.closest(CART_BUTTON_SELECTOR);
  if (!button) return undefined;
  const href = button.getAttribute('href');
  if (href !== null && href !== '') return workIdFromCartHref(href, pageUrl) ?? workIdFromUrl(resolve(href, pageUrl));
  return button.matches(PAGE_CART_BUTTON_SELECTOR) ? pageWorkId : undefined;
}

/** 點擊事件需要的欄位（MouseEvent 的子集，方便測試）。 */
export interface ClickLike {
  isTrusted: boolean;
  type: string;
  button: number;
  target: unknown;
}

function isElementLike(t: unknown): t is ElementLike {
  return typeof t === 'object' && t !== null && typeof (t as ElementLike).closest === 'function';
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

function resolve(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return '';
  }
}

/** 購物車頁的作品編號（F2）：不合格的略過，去掉重複，最多 200 件。 */
export function readCartIds(items: Iterable<ElementLike>): string[] {
  const ids: string[] = [];
  for (const item of items) {
    const id = item.getAttribute(CART_ITEM_ID_ATTR);
    if (isWorkId(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_CART_SNAPSHOT) break;
  }
  return ids;
}

export { CART_ITEM_SELECTOR };
