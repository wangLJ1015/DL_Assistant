// §3.4 對外請求的唯一出口。整個專案只有這個檔案可以呼叫 fetch（ESLint 強制）。
import { isWorkId } from '../ids';

export type EndpointKey = 'productInfo' | 'couponList' | 'dlwatcher';

export interface EndpointParams {
  productInfo: { ids: readonly string[] };
  couponList: Record<string, never>;
  dlwatcher: { id: string };
}

type CallerEnv = 'serviceWorker' | 'dlsitePage';

interface EndpointDef {
  origin: string;
  /** pathname 完全相等，或整段比對的 regex（dlwatcher）。 */
  path: string | RegExp;
  /** 允許的查詢參數名稱。 */
  params: readonly string[];
  init: RequestInit;
  callerEnv: CallerEnv;
  maxBytes: number;
}

const MB = 1024 * 1024;

/**
 * 每個請求（含讀取回應本體）最多等 30 秒，逾時當作連不上（§4.1）。
 * 回應一直不來時，查價佇列不會卡在這一步；Chrome 文件也寫 fetch 回應超過 30 秒時 service worker 可能被終止。
 */
export const REQUEST_TIMEOUT_MS = 30_000;

const ENDPOINTS: Readonly<Record<EndpointKey, EndpointDef>> = Object.freeze({
  productInfo: {
    origin: 'https://www.dlsite.com',
    path: '/maniax/product/info/ajax',
    params: ['product_id', 'cdn_cache_min'],
    init: { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' },
    callerEnv: 'serviceWorker',
    maxBytes: 5 * MB,
  },
  couponList: {
    origin: 'https://www.dlsite.com',
    path: '/home/mypage/coupon/list/ajax',
    params: [],
    init: { method: 'GET', credentials: 'same-origin', redirect: 'manual', cache: 'no-store', mode: 'same-origin' },
    callerEnv: 'dlsitePage',
    maxBytes: 1 * MB,
  },
  dlwatcher: {
    origin: 'https://dlwatcher.com',
    path: /^\/product\/(RJ|RE|BJ|VJ)(\d{6}|\d{8})\.json$/,
    params: [],
    init: { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' },
    callerEnv: 'serviceWorker',
    maxBytes: 2 * MB,
  },
});

/** 白名單的端點代號（快照測試鎖住筆數）。 */
export const ENDPOINT_KEYS = Object.freeze(Object.keys(ENDPOINTS) as EndpointKey[]);

/** 測試用：端點設定的唯讀檢視。 */
export function describeEndpoints(): Record<
  EndpointKey,
  { origin: string; path: string; params: readonly string[]; init: RequestInit; callerEnv: CallerEnv; maxBytes: number }
> {
  const out = {} as ReturnType<typeof describeEndpoints>;
  for (const key of ENDPOINT_KEYS) {
    const d = ENDPOINTS[key];
    out[key] = { ...d, path: String(d.path) };
  }
  return out;
}

// ---- 呼叫環境（§3.4）。Vitest 用 __setRuntimeEnvForTest 替換。----

export interface RuntimeEnv {
  isServiceWorker: boolean;
  locationOrigin: string | undefined;
  locationProtocol: string | undefined;
}

function detectRuntimeEnv(): RuntimeEnv {
  const g = globalThis as { location?: { origin?: string; protocol?: string } };
  const SWGS = (globalThis as { ServiceWorkerGlobalScope?: abstract new () => unknown }).ServiceWorkerGlobalScope;
  return {
    isServiceWorker: typeof SWGS !== 'undefined' && globalThis instanceof SWGS,
    locationOrigin: g.location?.origin,
    locationProtocol: g.location?.protocol,
  };
}

let getRuntimeEnv: () => RuntimeEnv = detectRuntimeEnv;

export function __setRuntimeEnvForTest(fn: (() => RuntimeEnv) | null): void {
  getRuntimeEnv = fn ?? detectRuntimeEnv;
}

function assertCallerEnv(key: EndpointKey): void {
  const env = getRuntimeEnv();
  const want = ENDPOINTS[key].callerEnv;
  if (want === 'serviceWorker') {
    if (!env.isServiceWorker || env.locationProtocol !== 'chrome-extension:') {
      throw new Error(`apiGet(${key}): only callable from the background service worker`);
    }
  } else if (env.locationOrigin !== 'https://www.dlsite.com') {
    throw new Error(`apiGet(${key}): only callable from a DLsite page`);
  }
}

// ---- URL 組裝與檢查 ----

function buildUrl<K extends EndpointKey>(key: K, params: EndpointParams[K]): string {
  const def = ENDPOINTS[key];
  switch (key) {
    case 'productInfo': {
      const { ids } = params as EndpointParams['productInfo'];
      // 2026-11-23 實測：DLsite 接受 URLSearchParams 把逗號編成 %2C（§10.3）。
      const qs = new URLSearchParams({ product_id: ids.join(','), cdn_cache_min: '1' });
      return `${def.origin}${def.path as string}?${qs.toString()}`;
    }
    case 'couponList':
      return `${def.origin}${def.path as string}`;
    case 'dlwatcher': {
      const { id } = params as EndpointParams['dlwatcher'];
      if (!isWorkId(id)) throw new Error('apiGet(dlwatcher): invalid work id');
      return `${def.origin}/product/${id}.json`;
    }
    default:
      throw new Error('apiGet: unknown endpoint');
  }
}

/**
 * 檢查網址是否完全符合該端點的白名單（§3.4）。不符就丟例外。
 * origin、pathname 完全相等；查詢參數只能是允許的名稱、各一次；username／password／hash 必須為空。
 */
export function assertAllowed(key: EndpointKey, rawUrl: string): URL {
  const def = ENDPOINTS[key];
  if (!def) throw new Error('assertAllowed: unknown endpoint');
  if (rawUrl.includes('#')) throw new Error('assertAllowed: fragment not allowed');
  const url = new URL(rawUrl);
  if (url.origin !== def.origin) throw new Error('assertAllowed: origin mismatch');
  if (url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new Error('assertAllowed: credentials or hash not allowed');
  }
  const pathOk = typeof def.path === 'string' ? url.pathname === def.path : def.path.test(url.pathname);
  if (!pathOk) throw new Error('assertAllowed: path mismatch');

  const names = [...url.searchParams.keys()];
  if (new Set(names).size !== names.length) throw new Error('assertAllowed: duplicated parameter');
  for (const n of names) {
    if (!def.params.includes(n)) throw new Error('assertAllowed: parameter not allowed');
  }
  if (def.params.length === 0 && url.search !== '') throw new Error('assertAllowed: query not allowed');

  if (key === 'productInfo') {
    if (names.length !== 2) throw new Error('assertAllowed: productInfo needs product_id and cdn_cache_min');
    if (url.searchParams.get('cdn_cache_min') !== '1') throw new Error('assertAllowed: cdn_cache_min must be 1');
    const ids = (url.searchParams.get('product_id') ?? '').split(',');
    if (ids.length < 1 || ids.length > 100) throw new Error('assertAllowed: product_id count out of range');
    if (!ids.every(isWorkId)) throw new Error('assertAllowed: invalid product_id');
    if (new Set(ids).size !== ids.length) throw new Error('assertAllowed: duplicated product_id');
  }
  return url;
}

// ---- 送出請求 ----

export type ApiResult =
  | { ok: true; status: number; text: string }
  | { ok: false; kind: 'opaqueredirect' }
  | { ok: false; kind: 'http'; status: number }
  | { ok: false; kind: 'tooLarge' }
  | { ok: false; kind: 'network' };

async function readTextLimited(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder('utf-8').decode(buf);
}

/**
 * 唯一的對外請求函式。不接受外部傳入的網址；回應內容不 log（§3.3）。
 */
export async function apiGet<K extends EndpointKey>(key: K, params: EndpointParams[K]): Promise<ApiResult> {
  assertCallerEnv(key);
  const def = ENDPOINTS[key];
  const url = assertAllowed(key, buildUrl(key, params));
  let res: Response;
  try {
    res = await fetch(url.href, { ...def.init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return { ok: false, kind: 'network' };
  }
  if (res.type === 'opaqueredirect') return { ok: false, kind: 'opaqueredirect' };
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, kind: 'http', status: res.status };
  }
  let text: string | null;
  try {
    text = await readTextLimited(res, def.maxBytes);
  } catch {
    return { ok: false, kind: 'network' };
  }
  if (text === null) return { ok: false, kind: 'tooLarge' };
  return { ok: true, status: res.status, text };
}
