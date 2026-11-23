// DLsite 的 DOM 選擇器與頁面網址的 regex（§3.2.6：集中在這裡，改版時只改一處）。
// content script 與 background 都會用（background 用來檢查 cartSnapshot 的 sender.url）。
// 2026-11-23 以 www.dlsite.com 實測（§10.3）。
import { isWorkId } from './ids';

/**
 * 加入購物車按鈕。
 * - 列表頁（排行榜、搜尋結果、作品頁的推薦區）：`a.btn_cart`，href 是 `/<分站>/cart/=/product_id/<ID>.html`。
 * - 作品頁本身：`button.btn_cart[data-ga4-ref="cart_add"]`，沒有 href（送 POST /api/cart/<分站>/add），編號從頁面網址取。
 */
export const CART_BUTTON_SELECTOR = 'a.btn_cart, button.btn_cart, [data-ga4-ref="cart_add"]';

/** 作品頁本身的加入購物車按鈕（沒有 href，編號只能從頁面網址取）。 */
export const PAGE_CART_BUTTON_SELECTOR = '[data-ga4-ref="cart_add"]';

/** 購物車頁的作品（推薦區也有 data-product_id，所以限定在 ul.cart_list 底下）。 */
export const CART_ITEM_SELECTOR = 'ul.cart_list > li.cart_list_item';
export const CART_ITEM_ID_ATTR = 'data-product-id';

/** 購物車頁：`/<分站>/cart` 或 `/<分站>/cart/`（各分站共用同一個購物車）。 */
const CART_PAGE_PATH_RE = /^\/[a-z]+(?:-[a-z]+)?\/cart\/?$/;

/** 列表頁加入購物車連結的路徑（不是作品頁網址，所以 §3.2.2 的 regex 不適用）。 */
const CART_ADD_PATH_RE = /^\/[a-z]+(?:-[a-z]+)?\/cart\/=\/product_id\/([A-Z]{2}\d{6,8})(?:\.html)?$/;

/** 安全地解析網址；只接受 https://www.dlsite.com、沒有帳號密碼。 */
function parseDlsiteUrl(href: string, base?: string): URL | null {
  if (href.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.host !== 'www.dlsite.com' || u.username !== '' || u.password !== '') return null;
  return u;
}

/** `url` 是不是購物車頁（cartSnapshot 只接受從購物車頁送來的訊息，§3.2.4）。 */
export function isCartPageUrl(url: string): boolean {
  const u = parseDlsiteUrl(url);
  return u !== null && CART_PAGE_PATH_RE.test(u.pathname);
}

/** 列表頁加入購物車連結的 href → 作品編號。其他網址回傳 undefined。 */
export function workIdFromCartHref(href: string, base: string): string | undefined {
  const u = parseDlsiteUrl(href, base);
  if (!u) return undefined;
  const m = CART_ADD_PATH_RE.exec(u.pathname);
  const id = m?.[1];
  return isWorkId(id) ? id : undefined;
}

/** 測試用：regex 本身（§3.2.6 ReDoS 測試）。 */
export const __regexForTest = { CART_PAGE_PATH_RE, CART_ADD_PATH_RE };
