// §5.3 IndexedDB：`history`（DLWatcher 的史低與歷史）與 `priceLog`（自己的查價紀錄）。
// 讀取：擴充功能頁面與 background；寫入：只有 background（§4.2，呼叫端要在 writeQueue 裡）。
// 不用 idb 套件：只需要幾個操作，自己包一層 Promise，少一個執行期相依套件（§11）。
// content script 讀不到擴充功能的 IndexedDB，也不能 import 這個檔案（§3.2.5）。
import { historyRecordSchema, priceLogEntrySchema, type HistoryRecord, type PriceLogEntry } from './models';
import { nextPriceLogEntry, type PriceObservation } from './price-log';

const DB_NAME = 'dl-assistant';
const DB_VERSION = 1;
const HISTORY = 'history';
const PRICE_LOG = 'priceLog';

let dbPromise: Promise<IDBDatabase> | null = null;
const versionChangeListeners = new Set<() => void>();

/** §4.2：別的頁面要升級資料庫時，這裡關閉連線並通知畫面（提示重新整理）。 */
export function onDbVersionChange(fn: () => void): () => void {
  versionChangeListeners.add(fn);
  return () => versionChangeListeners.delete(fn);
}

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.addEventListener('upgradeneeded', () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HISTORY)) db.createObjectStore(HISTORY, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PRICE_LOG)) db.createObjectStore(PRICE_LOG, { keyPath: ['id', 'at'] });
    });
    req.addEventListener('success', () => {
      const db = req.result;
      db.addEventListener('versionchange', () => {
        db.close();
        dbPromise = null;
        for (const fn of versionChangeListeners) fn();
      });
      db.addEventListener('close', () => {
        dbPromise = null;
      });
      resolve(db);
    });
    req.addEventListener('error', () => {
      dbPromise = null;
      reject(req.error ?? new Error('indexedDB.open failed'));
    });
    req.addEventListener('blocked', () => {
      // 舊版本的連線還開著；等它收到 versionchange 關閉後會繼續。
    });
  });
  return dbPromise;
}

/** 測試用：關閉並忘掉目前的連線（fake-indexeddb 換新的工廠之後）。 */
export async function __closeDbForTest(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p.catch(() => null))?.close();
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.addEventListener('success', () => resolve(r.result));
    r.addEventListener('error', () => reject(r.error ?? new Error('IDBRequest failed')));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.addEventListener('complete', () => resolve());
    tx.addEventListener('error', () => reject(tx.error ?? new Error('IDBTransaction failed')));
    tx.addEventListener('abort', () => reject(tx.error ?? new Error('IDBTransaction aborted')));
  });
}

/** 一件作品的 priceLog 範圍：[id] < [id, 任何字串] < [id, []]（陣列排在字串之後）。 */
const workRange = (id: string) => IDBKeyRange.bound([id], [id, []]);

// ---- history ----

/** 讀回的資料一律再跑 zod（§4.2）；不符的當作沒有。 */
export async function readHistory(id: string): Promise<HistoryRecord | undefined> {
  const db = await openDb();
  const raw: unknown = await req(db.transaction(HISTORY).objectStore(HISTORY).get(id));
  const r = historyRecordSchema.safeParse(raw);
  return r.success && r.data.id === id ? r.data : undefined;
}

export async function readAllHistory(): Promise<Map<string, HistoryRecord>> {
  const db = await openDb();
  const all: unknown[] = await req(db.transaction(HISTORY).objectStore(HISTORY).getAll());
  const out = new Map<string, HistoryRecord>();
  for (const raw of all) {
    const r = historyRecordSchema.safeParse(raw);
    if (r.success) out.set(r.data.id, r.data);
  }
  return out;
}

export async function writeHistory(rec: HistoryRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(HISTORY, 'readwrite');
  tx.objectStore(HISTORY).put(historyRecordSchema.parse(rec));
  await done(tx);
}

// ---- priceLog ----

function validEntries(all: unknown[]): PriceLogEntry[] {
  const out: PriceLogEntry[] = [];
  for (const raw of all) {
    const r = priceLogEntrySchema.safeParse(raw);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** 一件作品的查價紀錄，依 `at` 由舊到新。 */
export async function readPriceLog(id: string): Promise<PriceLogEntry[]> {
  const db = await openDb();
  const all: unknown[] = await req(db.transaction(PRICE_LOG).objectStore(PRICE_LOG).getAll(workRange(id)));
  return validEntries(all).filter((e) => e.id === id);
}

/** 全部作品的查價紀錄（擴充功能頁面用），每件依 `at` 由舊到新。 */
export async function readAllPriceLogs(): Promise<Map<string, PriceLogEntry[]>> {
  const db = await openDb();
  const all: unknown[] = await req(db.transaction(PRICE_LOG).objectStore(PRICE_LOG).getAll());
  const out = new Map<string, PriceLogEntry[]>();
  for (const e of validEntries(all)) {
    const list = out.get(e.id);
    if (list) list.push(e);
    else out.set(e.id, [e]);
  }
  return out;
}

/**
 * 一批查價結果寫進 priceLog（§4.2：一個 transaction）。每件作品讀最後一筆，
 * 依 §5.3 的規則新增一筆或只更新最後一筆的 `lastSeenAt`。回傳新增的筆數。
 */
export async function appendPriceObservations(obs: readonly PriceObservation[], gapMs: number): Promise<number> {
  if (obs.length === 0) return 0;
  const db = await openDb();
  const tx = db.transaction(PRICE_LOG, 'readwrite');
  const store = tx.objectStore(PRICE_LOG);
  const finished = done(tx);
  let added = 0;
  // 同一個 transaction 裡依序處理；await 的都是這個 transaction 的請求，transaction 不會提早結束。
  for (const o of obs) {
    const cursor = await req(store.openCursor(workRange(o.id), 'prev'));
    const parsed = cursor ? priceLogEntrySchema.safeParse(cursor.value) : undefined;
    const last = parsed?.success && parsed.data.id === o.id ? parsed.data : undefined;
    const next = nextPriceLogEntry(last, o, gapMs);
    if (!next) continue;
    store.put(next.entry);
    if (next.isNew) added++;
  }
  await finished;
  return added;
}
