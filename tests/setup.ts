// IndexedDB（history、priceLog）用 fake-indexeddb。每個測試換一個新的資料庫。
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';
import { __closeDbForTest } from '../src/lib/db';

beforeEach(async () => {
  await __closeDbForTest();
  globalThis.indexedDB = new IDBFactory();
});
