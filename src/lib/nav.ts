// §3.4 導覽：唯一可以開分頁與視窗的檔案。
import { browser } from 'wxt/browser';
import { isWorkId } from './ids';

/** 只有 ids.ts 的 buildWorkUrl() 與本檔的 NAV_URLS 能產生。 */
export type DlsiteNavUrl = string & { readonly __brand: 'DlsiteNavUrl' };
/** 只有 extPageUrl() 能產生（chrome.runtime.getURL 組出的擴充功能頁面網址）。 */
export type ExtPageUrl = string & { readonly __brand: 'ExtPageUrl' };

/**
 * 固定的 DLsite 網址常數（§3.4）。只有購物車頁（2026-11-23 實測；各分站共用同一個購物車）。
 * 打開購物車頁只是瀏覽（GET），加入／移除購物車是別的路徑（/cart/=/product_id/…、/cart/ajax/…、/api/cart/…）。
 * 不提供優惠券管理頁（§3.4「不提供優惠券管理頁的連結」）。
 */
export const NAV_URLS = {
  cart: 'https://www.dlsite.com/home/cart/' as DlsiteNavUrl,
} as const satisfies Record<string, DlsiteNavUrl>;
export type NavName = keyof typeof NAV_URLS;

export type ExtPage = 'dashboard' | 'lookup' | 'planner';

const EXT_PAGE_PATHS = {
  dashboard: '/dashboard.html',
  lookup: '/lookup.html',
  planner: '/planner.html',
} as const satisfies Record<ExtPage, string>;

/**
 * 擴充功能頁面網址。`lookup` 的 `id` 必須通過 isWorkId()；`dashboard` 的 `n` 是通知 ID（長度 ≤ 64）。
 */
export function extPageUrl(page: ExtPage, params: { id?: string; n?: string } = {}): ExtPageUrl {
  const search = new URLSearchParams();
  if (page === 'lookup') {
    if (!isWorkId(params.id)) throw new Error('extPageUrl: invalid work id');
    search.set('id', params.id);
  } else if (params.id !== undefined) {
    throw new Error('extPageUrl: id is only allowed for lookup');
  }
  if (params.n !== undefined) {
    if (page !== 'dashboard' || params.n.length === 0 || params.n.length > 64) {
      throw new Error('extPageUrl: invalid notification id');
    }
    search.set('n', params.n);
  }
  const qs = search.toString();
  // getURL 的型別只接受打包時存在的路徑；dashboard 等頁面在後續里程碑才加入，所以這裡先轉成 string。
  const getURL = browser.runtime.getURL as (path: string) => string;
  return (getURL(EXT_PAGE_PATHS[page]) + (qs ? `?${qs}` : '')) as ExtPageUrl;
}

export async function openTab(url: DlsiteNavUrl | ExtPageUrl): Promise<void> {
  await browser.tabs.create({ url });
}

/** F13 的小視窗（§7.1）。只開擴充功能自己的頁面。 */
export async function openPopupWindow(url: ExtPageUrl): Promise<void> {
  await browser.windows.create({ type: 'popup', url, width: 420, height: 520 });
}
