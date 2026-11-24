import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { SenderLike } from '../src/lib/messages';

// 查價不打網路：自動加入後的 refreshPrices 一律回「查不到」
const apiGet = vi.fn();
vi.mock('../src/lib/api/endpoints', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));

const { handleContentMessage } = await import('../src/lib/content-handlers');
const { claimDocument } = await import('../src/lib/auto-track');
const { readDailyAutoAdd, readItems, readLastCart, writeStore } = await import('../src/lib/storage');
const { __setTimingForTest, whenIdle } = await import('../src/lib/queue');
const { jstDate, nowIso } = await import('../src/lib/dates');

const ID = 'abcdefghijklmnopabcdefghijklmnop';
let doc = 0;
const sender = (url: string, documentId = `doc-${++doc}`): SenderLike => ({
  id: ID,
  origin: 'https://www.dlsite.com',
  url,
  frameId: 0,
  tab: { id: 1 },
  documentId,
  documentLifecycle: 'active',
});
const CART = 'https://www.dlsite.com/home/cart/';
const WORK = 'https://www.dlsite.com/home/work/=/product_id/RJ01014447.html';
const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `RJ${String(from + i).padStart(8, '0')}`);
const today = () => jstDate(nowIso());

beforeEach(() => {
  fakeBrowser.reset();
  __setTimingForTest({ productIntervalMs: 0, dlwatcherIntervalMs: 0 });
  apiGet.mockReset();
  apiGet.mockImplementation(async (key: string) =>
    key === 'productInfo' ? { ok: true, status: 200, text: '[]' } : { ok: false, kind: 'http', status: 404 },
  );
});

afterEach(async () => {
  await whenIdle();
  __setTimingForTest();
});

describe('cartClicked (F1)', () => {
  it('adds the work as an auto-added cart item and counts it toward the daily limit', async () => {
    expect(await handleContentMessage({ type: 'cartClicked', id: 'RJ01014447' }, sender(WORK))).toEqual({ ok: true });
    expect((await readItems()).get('RJ01014447')).toMatchObject({ source: 'cart', autoAdded: true, paused: false });
    expect(await readDailyAutoAdd(today())).toMatchObject({ count: 1, skipped: 0 });
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalledWith('productInfo', { ids: ['RJ01014447'] }));
  });

  it('does not count works already tracked', async () => {
    await handleContentMessage({ type: 'cartClicked', id: 'RJ01014447' }, sender(WORK));
    await handleContentMessage({ type: 'cartClicked', id: 'RJ01014447' }, sender(WORK));
    expect(await readDailyAutoAdd(today())).toMatchObject({ count: 1 });
  });
});

describe('cartSnapshot (F2)', () => {
  it('only accepts the cart page', async () => {
    for (const url of [WORK, 'https://www.dlsite.com/home/cart/=/product_id/RJ01014447.html', 'https://evil.example/home/cart/']) {
      expect(await handleContentMessage({ type: 'cartSnapshot', ids: ['RJ01014447'] }, sender(url))).toEqual({
        ok: false,
        reason: 'notCartPage',
      });
    }
    expect((await readItems()).size).toBe(0);
  });

  it('accepts one snapshot per document', async () => {
    const s = sender(CART, 'same-doc');
    expect(await handleContentMessage({ type: 'cartSnapshot', ids: ['RJ01014447'] }, s)).toEqual({ ok: true });
    expect(await handleContentMessage({ type: 'cartSnapshot', ids: ['RJ123456'] }, s)).toEqual({ ok: false, reason: 'duplicate' });
    expect([...(await readItems()).keys()]).toEqual(['RJ01014447']);
    // 沒有 documentId 的也拒絕
    expect(await handleContentMessage({ type: 'cartSnapshot', ids: ['RJ123456'] }, { ...sender(CART), documentId: undefined })).toEqual({
      ok: false,
      reason: 'duplicate',
    });
  });

  it('adds at most 50 new works and records lastCart', async () => {
    const all = ids(80);
    expect(await handleContentMessage({ type: 'cartSnapshot', ids: all }, sender(CART))).toEqual({ ok: true });
    expect((await readItems()).size).toBe(50);
    expect(await readDailyAutoAdd(today())).toMatchObject({ count: 50, skipped: 30 });
    expect(await readLastCart()).toMatchObject({ ids: all });
  });

  it('an empty cart still updates lastCart', async () => {
    await handleContentMessage({ type: 'cartSnapshot', ids: [] }, sender(CART));
    expect(await readLastCart()).toMatchObject({ ids: [] });
  });
});

describe('daily limit (§3.2.4)', () => {
  it('stops at 200 auto-added works per day across cartClicked, cartSnapshot and track', async () => {
    await writeStore({ dailyAutoAdd: { date: today(), count: 198, skipped: 0 } });
    await handleContentMessage({ type: 'cartClicked', id: 'RJ00000001' }, sender(WORK));
    await handleContentMessage({ type: 'track', id: 'RJ00000002' }, sender(WORK));
    await handleContentMessage({ type: 'cartClicked', id: 'RJ00000003' }, sender(WORK));
    await handleContentMessage({ type: 'track', id: 'RJ00000004' }, sender(WORK));
    await handleContentMessage({ type: 'cartSnapshot', ids: ids(5, 10) }, sender(CART));
    expect([...(await readItems()).keys()].sort()).toEqual(['RJ00000001', 'RJ00000002']);
    expect(await readDailyAutoAdd(today())).toMatchObject({ count: 200, skipped: 7 });
  });

  it('resets on a new JST day', async () => {
    await writeStore({ dailyAutoAdd: { date: '2000-01-01', count: 200, skipped: 9 } });
    await handleContentMessage({ type: 'cartClicked', id: 'RJ01014447' }, sender(WORK));
    expect(await readDailyAutoAdd(today())).toMatchObject({ count: 1, skipped: 0 });
  });

  it('respects the 1,000-item list limit', async () => {
    const items = new Map(
      ids(1000).map((id) => [
        id,
        {
          id,
          site: 'maniax',
          title: '',
          imageUrl: '',
          addedAt: '2026-11-23T00:00:00.000Z',
          source: 'manual' as const,
          autoAdded: false,
          paused: false,
        },
      ]),
    );
    await writeStore({ items });
    await handleContentMessage({ type: 'cartClicked', id: 'RJ01014447' }, sender(WORK));
    expect((await readItems()).has('RJ01014447')).toBe(false);
    expect(await readDailyAutoAdd(today())).toMatchObject({ count: 0, skipped: 1 });
  });
});

describe('track from a content script', () => {
  it('is always recorded as source "page", once per document', async () => {
    const s = sender(WORK, 'work-doc');
    expect(await handleContentMessage({ type: 'track', id: 'RJ01014447' }, s)).toEqual({ ok: true });
    expect(await handleContentMessage({ type: 'track', id: 'RJ123456' }, s)).toEqual({ ok: false, reason: 'duplicate' });
    expect((await readItems()).get('RJ01014447')).toMatchObject({ source: 'page', autoAdded: true });
    expect((await readItems()).has('RJ123456')).toBe(false);
    expect(await readDailyAutoAdd(today())).toMatchObject({ count: 1 });
  });
});

describe('not implemented yet', () => {
  it.each([
    { type: 'badgeInfo', id: 'RJ01014447' },
    { type: 'lookup', id: 'RJ01014447' },
    { type: 'openPage', page: 'dashboard' },
    { type: 'shouldSyncCoupons' },
  ] as const)('$type', async (msg) => {
    expect(await handleContentMessage(msg, sender(WORK))).toEqual({ ok: false, reason: 'notImplemented' });
  });
});

describe('seenDocuments', () => {
  it('keeps kinds separate and rejects bad ids', async () => {
    expect(await claimDocument('cart', 'd1')).toBe(true);
    expect(await claimDocument('track', 'd1')).toBe(true);
    expect(await claimDocument('cart', 'd1')).toBe(false);
    expect(await claimDocument('cart', '')).toBe(false);
    expect(await claimDocument('cart', 'x'.repeat(101))).toBe(false);
  });

  it('forgets documents after an hour and survives malformed storage', async () => {
    await fakeBrowser.storage.session.set({ seenDocuments: { cart: [['old', '2000-01-01T00:00:00.000Z']], track: 'broken' } });
    expect(await claimDocument('cart', 'old')).toBe(true);
    expect(await claimDocument('track', 'd2')).toBe(true);
  });

  it('keeps the latest 500', async () => {
    for (let i = 0; i < 505; i++) await claimDocument('badge', `b${i}`);
    const got = (await fakeBrowser.storage.session.get('seenDocuments')).seenDocuments as { badge: unknown[] };
    expect(got.badge).toHaveLength(500);
    expect(await claimDocument('badge', 'b504')).toBe(false);
    expect(await claimDocument('badge', 'b0')).toBe(true);
  });
});

describe('M2 review fixes', () => {
  it('cartSnapshot does not re-add a work the user removed; a new cart click does (§5.3 untracked)', async () => {
    const { untrackItem: untrack } = await import('../src/lib/tracking');
    const { readUntracked } = await import('../src/lib/storage');
    await handleContentMessage({ type: 'cartClicked', id: 'RJ01014447' }, sender(WORK));
    expect(await untrack('RJ01014447')).toEqual({ ok: true });
    expect((await readUntracked()).has('RJ01014447')).toBe(true);

    await handleContentMessage({ type: 'cartSnapshot', ids: ['RJ01014447', 'RJ123456'] }, sender(CART));
    expect([...(await readItems()).keys()]).toEqual(['RJ123456']);
    expect(await readLastCart()).toMatchObject({ ids: ['RJ01014447', 'RJ123456'] });

    await handleContentMessage({ type: 'cartClicked', id: 'RJ01014447' }, sender(WORK));
    expect((await readItems()).has('RJ01014447')).toBe(true);
    expect((await readUntracked()).has('RJ01014447')).toBe(false);
  });

  it('manual add clears the removal record', async () => {
    const tracking = await import('../src/lib/tracking');
    const { readUntracked } = await import('../src/lib/storage');
    await tracking.trackItem('RJ01014447', 'manual', { awaitPrice: true });
    await tracking.untrackItem('RJ01014447');
    await tracking.trackItem('RJ01014447', 'manual', { awaitPrice: true });
    expect((await readUntracked()).size).toBe(0);
  });

  it('replies rateLimited / limit when nothing could be added (§3.2.4)', async () => {
    await writeStore({ dailyAutoAdd: { date: today(), count: 200, skipped: 0 } });
    expect(await handleContentMessage({ type: 'cartClicked', id: 'RJ01014447' }, sender(WORK))).toEqual({
      ok: false,
      reason: 'rateLimited',
    });
    expect(await handleContentMessage({ type: 'track', id: 'RJ01014447' }, sender(WORK))).toEqual({ ok: false, reason: 'rateLimited' });
    expect(await handleContentMessage({ type: 'cartSnapshot', ids: ['RJ123456'] }, sender(CART))).toEqual({
      ok: false,
      reason: 'rateLimited',
    });
    // 已追蹤的作品不算被擋
    await writeStore({ dailyAutoAdd: { date: today(), count: 0, skipped: 0 } });
    await handleContentMessage({ type: 'cartClicked', id: 'RJ01014447' }, sender(WORK));
    await writeStore({ dailyAutoAdd: { date: today(), count: 200, skipped: 0 } });
    expect(await handleContentMessage({ type: 'cartClicked', id: 'RJ01014447' }, sender(WORK))).toEqual({ ok: true });
  });

  it('a partially accepted cartSnapshot is ok', async () => {
    expect(await handleContentMessage({ type: 'cartSnapshot', ids: ids(60) }, sender(CART))).toEqual({ ok: true });
  });

  it('replies limit when the list is full', async () => {
    const items = new Map(
      ids(1000).map((id) => [
        id,
        {
          id,
          site: 'maniax',
          title: '',
          imageUrl: '',
          addedAt: '2026-11-23T00:00:00.000Z',
          source: 'manual' as const,
          autoAdded: false,
          paused: false,
        },
      ]),
    );
    await writeStore({ items });
    expect(await handleContentMessage({ type: 'cartClicked', id: 'RJ01014447' }, sender(WORK))).toEqual({ ok: false, reason: 'limit' });
  });
});
