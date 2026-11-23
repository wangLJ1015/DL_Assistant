// §3.2.2 作品編號、分站與作品頁網址。
// 只 import 型別（編譯後消失），content script 用 ids.ts 時不會把 nav.ts 打包進去。
import type { DlsiteNavUrl } from './nav';

const WORK_ID_RE = /^(RJ|RE|BJ|VJ)(\d{6}|\d{8})$/;

export function isWorkId(s: unknown): s is string {
  return typeof s === 'string' && WORK_ID_RE.test(s);
}

/**
 * 可以組進作品頁網址的分站（§3.2.2）。2026-11-23 實測（§10.3）：
 * - 下列分站的 `/{site}/work/=/product_id/{id}.html` 都留在 www.dlsite.com（200 或轉到正確分站）。
 * - `comic` 會轉址到站外（www.comipo.app），所以不列入；`aix`、`ecchi-eng` 不是作品頁，也不列入。
 */
export const SITES = [
  'maniax',
  'home',
  'books',
  'pro',
  'soft',
  'girls',
  'girls-pro',
  'girls-drama',
  'bl',
  'bl-pro',
  'bl-drama',
  'appx',
] as const;
export type Site = (typeof SITES)[number];

const SITE_SET: ReadonlySet<string> = new Set(SITES);

export function isSite(s: unknown): s is Site {
  return typeof s === 'string' && SITE_SET.has(s);
}

/** 不在列舉內的分站一律用 maniax（實測 maniax 路徑可以開啟 home 的作品）。 */
export function normalizeSite(s: unknown): Site {
  return isSite(s) ? s : 'maniax';
}

/**
 * 作品頁網址的唯一產生方式（§3.4 第 1 層）。`id` 不合法時丟例外，不產生任何網址。
 */
export function buildWorkUrl(site: unknown, id: string): DlsiteNavUrl {
  if (!isWorkId(id)) throw new Error('buildWorkUrl: invalid work id');
  return `https://www.dlsite.com/${normalizeSite(site)}/work/=/product_id/${id}.html` as DlsiteNavUrl;
}

// 分站名稱可能含一個連字號（girls-pro、bl-drama…），v0.7 規格的 `^/[a-z]+/` 比對不到，這裡放寬成 `[a-z]+(-[a-z]+)?`。
const WORK_PATH_RE = /^\/[a-z]+(?:-[a-z]+)?\/(?:work|announce)\/=\/product_id\/([A-Z]{2}\d{6,8})(?:\.html)?(?:\/|$)/;

/** 從網址取作品編號（F1、F13）。只處理 https://www.dlsite.com 的作品頁，其他網址回傳 undefined。 */
export function workIdFromUrl(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || u.host !== 'www.dlsite.com') return undefined;
  if (u.username !== '' || u.password !== '') return undefined;
  const m = WORK_PATH_RE.exec(u.pathname);
  const id = m?.[1];
  return isWorkId(id) ? id : undefined;
}

/**
 * 圖片網址（§3.2.2）：`//` 開頭先補 `https:`，只接受 origin 為 https://img.dlsite.jp 而且沒有帳密的網址。
 * 不符時回傳空字串（畫面顯示預設圖）。
 */
export function normalizeImageUrl(raw: string): string {
  const s = raw.startsWith('//') ? `https:${raw}` : raw;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return '';
  }
  if (u.origin !== 'https://img.dlsite.jp' || u.username !== '' || u.password !== '') return '';
  return u.href;
}

/** 測試用：regex 本身（§3.2.6 ReDoS 測試直接對 regex 餵長字串）。 */
export const __regexForTest = { WORK_ID_RE, WORK_PATH_RE };
