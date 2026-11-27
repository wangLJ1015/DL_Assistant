// M4 通知：§6.1 的處理步驟接在查價流程上（price-check.ts）、§4.2 一批一次寫入再通知、§6.2 通知內容與點擊、
// §3.6 DLWatcher 自動暫停的系統通知。商品 API 由 apiGet 的 mock 回應，DLWatcher 一律 404。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TrackedItem } from '../src/lib/models';

const apiGet = vi.fn();
vi.mock('../src/lib/api/endpoints', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));
/** priceLog 的寫入失敗（IndexedDB 出錯）。 */
const flags = vi.hoisted(() => ({ failPriceLog: false }));
vi.mock('../src/lib/db', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/lib/db')>();
  return {
    ...orig,
    appendPriceObservations: (...a: Parameters<typeof orig.appendPriceObservations>) =>
      flags.failPriceLog ? Promise.reject(new Error('IndexedDB write failed')) : orig.appendPriceObservations(...a),
  };
});

const { refreshPrices, setPaused, setTarget, untrackItem, updateSettings } = await import('../src/lib/tracking');
const queue = await import('../src/lib/queue');
const { __setTimingForTest, whenIdle } = queue;
const {
  isRuleStateKey,
  readItems,
  readNotified,
  readRecentNotifications,
  readRuleState,
  readSettings,
  readSnapshots,
  writeStore,
  STORAGE_KEYS,
} = await import('../src/lib/storage');
const { buildWorkNotice, formatYen, handleNotificationClick, sanitizeForNotification } = await import('../src/lib/notify');
const { ruleStateKey } = await import('../src/lib/rules');

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `RJ${String(from + i).padStart(8, '0')}`);
const item = (id: string, patch: Partial<TrackedItem> = {}): TrackedItem => ({
  id,
  site: 'maniax',
  title: '',
  imageUrl: '',
  addedAt: '2026-11-23T00:00:00.000Z',
  source: 'manual',
  autoAdded: false,
  paused: false,
  ...patch,
});
const seed = (list: string[], patch: Partial<TrackedItem> = {}) => writeStore({ items: new Map(list.map((id) => [id, item(id, patch)])) });

interface Price {
  price: number;
  official?: number;
  campaign?: string;
  /** JST 的 "YYYY-MM-DD HH:mm:ss"。 */
  end?: string;
  name?: string;
}
/** 每件作品這次的價格；不在這裡的作品回應裡沒有（查不到）。 */
let prices = new Map<string, Price>();
const setAll = (list: string[], p: Price) => {
  for (const id of list) prices.set(id, p);
};

function productFor(reqIds: readonly string[]): string {
  const out: Record<string, unknown> = {};
  for (const id of reqIds) {
    const p = prices.get(id);
    if (!p) continue;
    const official = p.official ?? 2000;
    const discounted = p.price < official;
    out[id] = {
      work_name: p.name ?? `作品 ${id}`,
      work_image: `//img.dlsite.jp/modpub/images2/work/doujin/RJ01015000/${id}_img_main.jpg`,
      price: p.price,
      official_price: official,
      is_discount: discounted,
      ...(discounted ? { discount_rate: Math.round((1 - p.price / official) * 100) } : {}),
      ...(p.campaign ? { campaign_id: p.campaign } : {}),
      ...(p.end ? { discount_end_date: p.end } : {}),
      default_point_rate: 1,
      is_sold_out: false,
      site_id: 'home',
      work_type: 'SOU',
      custom_genres: [],
      is_noreduction: false,
    };
  }
  return Object.keys(out).length === 0 ? '[]' : JSON.stringify(out);
}

const created = () => fakeBrowser.notifications.getAllCreateOptions();
const createdList = () => Object.entries(created());

async function check(list: string[]) {
  const r = await refreshPrices(list);
  await whenIdle();
  return r;
}

beforeEach(() => {
  fakeBrowser.reset();
  __setTimingForTest({ productIntervalMs: 0, dlwatcherIntervalMs: 0 });
  prices = new Map();
  flags.failPriceLog = false;
  apiGet.mockReset();
  apiGet.mockImplementation(async (key: string, p: { ids?: string[] }) =>
    key === 'productInfo' ? { ok: true, status: 200, text: productFor(p.ids!) } : { ok: false, kind: 'http', status: 404 },
  );
});
afterEach(async () => {
  await whenIdle();
  __setTimingForTest();
  vi.restoreAllMocks();
});

describe('M4 completion criteria', () => {
  it('notifies once when a work goes on sale, again after it returns to the regular price and goes on sale again', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 2000 });
    await check([id!]); // 建立基準
    expect((await readItems()).get(id!)?.baselineAt).toBeDefined();
    expect(createdList()).toHaveLength(0);

    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]);
    expect(createdList()).toHaveLength(1);
    await check([id!]);
    expect(createdList()).toHaveLength(1);

    setAll([id!], { price: 2000 });
    await check([id!]);
    expect(createdList()).toHaveLength(1);

    setAll([id!], { price: 1000, campaign: 'c2' });
    await check([id!]);
    expect(createdList()).toHaveLength(2);
    const recent = await readRecentNotifications();
    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatchObject({ ids: [id], rules: ['sale', 'lowest'] });
  });

  it('three works going on sale in one batch → one merged notification', async () => {
    const list = ids(3);
    await seed(list);
    setAll(list, { price: 2000 });
    await check(list);
    setAll(list, { price: 1000, campaign: 'c1' });
    await check(list);
    const all = createdList();
    expect(all).toHaveLength(1);
    const [nid, opts] = all[0]!;
    expect(opts).toMatchObject({ type: 'basic', title: 'DL_Assistant：特價、史低' });
    expect(opts.message).toMatch(/^3 個追蹤作品正在特價\n/);
    expect(opts.iconUrl).toMatch(/\/icon\/128\.png$/);
    const recent = await readRecentNotifications();
    expect(recent).toEqual([expect.objectContaining({ notificationId: nid, ids: list, rules: ['sale', 'lowest'] })]);
    expect((await readNotified()).size).toBe(6); // 3 件 × sale、lowest
  });

  it('no re-notification after being unavailable once (no campaignId, no discountEnd)', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 2000 });
    await check([id!]);
    setAll([id!], { price: 1000 });
    await check([id!]);
    expect(createdList()).toHaveLength(1);
    prices.delete(id!);
    await check([id!]);
    expect((await readSnapshots()).get(id!)?.available).toBe(false);
    setAll([id!], { price: 1000 });
    await check([id!]);
    expect(createdList()).toHaveLength(1);
  });

  it('paused and resumed while on sale → no notification for the next two checks', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 2000 });
    await check([id!]);
    expect(await setPaused(id!, true)).toEqual({ ok: true });
    setAll([id!], { price: 1000, campaign: 'c1' });
    // 暫停中不查價
    expect(await refreshPrices([id!])).toEqual({ ok: true, updated: 0, missing: 0, invalid: 0 });
    expect(await setPaused(id!, false)).toEqual({ ok: true });
    // 恢復時排的查價 → 重新建立基準
    await vi.waitFor(async () => expect((await readItems()).get(id!)?.baselineAt).toBeDefined());
    await whenIdle();
    await check([id!]);
    expect(createdList()).toHaveLength(0);
    expect((await readSnapshots()).get(id!)?.episode?.key).toBe('c1');
  });

  it('raising the target price above the current price during a sale → no target notification', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 2000 });
    await check([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]);
    expect(createdList()).toHaveLength(1);
    expect(await setTarget(id!, 1200)).toEqual({ ok: true });
    expect((await readItems()).get(id!)?.targetPrice).toBe(1200);
    expect((await readRuleState()).get(ruleStateKey('work', id!, 'target'))?.active).toBe(true);
    await check([id!]);
    expect(createdList()).toHaveLength(1);
    // 目標價調低到現價以下：不成立；之後降到目標價才通知
    expect(await setTarget(id!, 900)).toEqual({ ok: true });
    expect((await readRuleState()).has(ruleStateKey('work', id!, 'target'))).toBe(false);
    setAll([id!], { price: 900, campaign: 'c1' });
    await check([id!]);
    expect(createdList()).toHaveLength(2);
    // 同一段優惠裡再降價：lowest 已經成立，不重發（「折扣又加深」在第二階段）
    expect((await readRecentNotifications())[0]?.rules).toEqual(['target']);
    // 清掉目標價
    expect(await setTarget(id!, undefined)).toEqual({ ok: true });
    expect((await readItems()).get(id!)?.targetPrice).toBeUndefined();
    expect(await setTarget('RJ09999999', 100)).toEqual({ ok: false, reason: 'notTracked' });
  });
});

describe('§4.2 write before notify', () => {
  it('the notification is created only after storage is written, with the same notification id', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 2000 });
    await check([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    let seenAtCreate: unknown;
    const realCreate = fakeBrowser.notifications.create.bind(fakeBrowser.notifications);
    vi.spyOn(fakeBrowser.notifications, 'create').mockImplementation((async (nid: string, opts: unknown) => {
      seenAtCreate = (await fakeBrowser.storage.local.get(STORAGE_KEYS.recentNotifications))[STORAGE_KEYS.recentNotifications];
      return realCreate(nid, opts as never);
    }) as never);
    await check([id!]);
    const [nid] = Object.keys(created());
    expect(seenAtCreate).toEqual([expect.objectContaining({ notificationId: nid })]);
  });

  it('writes snapshots, ruleState, notified and recentNotifications in a single storage.local.set', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 2000 });
    await check([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    const spy = vi.spyOn(fakeBrowser.storage.local, 'set');
    await check([id!]);
    const withSnapshots = spy.mock.calls.filter(([v]) => STORAGE_KEYS.snapshots in (v as object));
    expect(withSnapshots).toHaveLength(1);
    expect(Object.keys(withSnapshots[0]![0] as object)).toEqual(
      expect.arrayContaining(['items', 'snapshots', 'ruleState', 'notified', 'recentNotifications']),
    );
  });

  it('if the storage write fails, nothing is notified (rather miss than duplicate)', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 2000 });
    await check([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    const realSet = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
    vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation((async (v: Record<string, unknown>) => {
      if (STORAGE_KEYS.snapshots in v) throw new Error('quota');
      return realSet(v);
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await refreshPrices([id!]);
    await whenIdle();
    expect(createdList()).toHaveLength(0);
    expect(await readRecentNotifications()).toHaveLength(0);
  });
});

describe('§6.2 content and click', () => {
  it('single work: title, price, discount, difference from the lowest and end time', async () => {
    const [id] = ids(1);
    await seed([id!]);
    // 換行與 U+202E（從右到左覆寫）
    const name = ['作品名', '第2巻' + String.fromCharCode(0x202e)].join('\n');
    for (const p of [{ price: 2000 }, { price: 1500, campaign: 'c0' }, { price: 2000 }]) {
      setAll([id!], { ...p, name });
      await check([id!]);
    }
    // JST 2026-12-31 23:59:59 = 台北 22:59
    setAll([id!], { price: 1000, campaign: 'c1', end: '2026-12-31 23:59:59', name });
    await check([id!]);
    const opts = created()[(await readRecentNotifications())[0]!.notificationId]!;
    expect(opts.title).toBe('DL_Assistant：特價、史低');
    expect(opts.message).toBe('作品名 第2巻\n¥1,000（原價 ¥2,000，50% OFF）\n比史低再低 ¥500\n截止 12/31 22:59');
  });

  it('hideTitlesInNotifications: only "1 個追蹤作品正在特價"', async () => {
    const [id] = ids(1);
    await seed([id!]);
    await updateSettings({ hideTitlesInNotifications: true });
    setAll([id!], { price: 2000, name: '秘密の作品' });
    await check([id!]);
    setAll([id!], { price: 1000, campaign: 'c1', name: '秘密の作品' });
    await check([id!]);
    const [, opts] = createdList()[0]!;
    expect(opts.message).toBe('1 個追蹤作品正在特價');
    expect(JSON.stringify(opts)).not.toContain('秘密');
  });

  it('disabled rules do not notify', async () => {
    const [id] = ids(1);
    await seed([id!]);
    const rules = (await readSettings()).rules;
    await updateSettings({ rules: { ...rules, sale: false, lowest: false } });
    setAll([id!], { price: 2000 });
    await check([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]);
    expect(createdList()).toHaveLength(0);
  });

  it('click: a single work opens its work page, a merged one opens dashboard.html?n=<id>, then the notification is cleared', async () => {
    const list = ids(3);
    await seed(list);
    setAll(list, { price: 2000 });
    await check(list);
    setAll(list.slice(0, 1), { price: 1000, campaign: 'c1' });
    await check(list);
    setAll(list.slice(1), { price: 1000, campaign: 'c1' });
    await check(list);
    const [single, merged] = (await readRecentNotifications()).reverse();
    const tabsCreate = vi.spyOn(fakeBrowser.tabs, 'create');
    await handleNotificationClick(single!.notificationId);
    expect(tabsCreate).toHaveBeenLastCalledWith({ url: `https://www.dlsite.com/home/work/=/product_id/${list[0]}.html` });
    await handleNotificationClick(merged!.notificationId);
    expect(tabsCreate).toHaveBeenLastCalledWith({ url: expect.stringMatching(/\/dashboard\.html\?n=[0-9a-f-]{36}$/) });
    expect(tabsCreate.mock.lastCall![0].url).toContain(`?n=${merged!.notificationId}`);
    expect(createdList()).toHaveLength(0); // 點擊後關掉
    // 不在 recentNotifications 裡的 ID：什麼都不開
    await handleNotificationClick('unknown');
    expect(tabsCreate).toHaveBeenCalledTimes(2);
  });

  it('keeps at most 50 recent notifications, newest first', async () => {
    const recent = Array.from({ length: 50 }, (_, i) => ({
      notificationId: `n${i}`,
      ids: ['RJ01014447'],
      rules: ['sale' as const],
      text: 'x',
      at: '2026-11-23T00:00:00.000Z',
    }));
    await writeStore({ recentNotifications: recent });
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 2000 });
    await check([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]);
    const got = await readRecentNotifications();
    expect(got).toHaveLength(50);
    expect(got[0]?.ids).toEqual([id]);
    expect(got.at(-1)?.notificationId).toBe('n48');
  });
});

describe('M4 review fixes and missing cases (v0.16)', () => {
  it('#1 resumed while on sale, the first check after resuming is unavailable → no notification afterwards', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]); // 加入時已在打折
    await setPaused(id!, true);
    prices.delete(id!);
    await setPaused(id!, false);
    await vi.waitFor(async () => expect((await readSnapshots()).get(id!)?.available).toBe(false));
    await whenIdle();
    expect((await readItems()).get(id!)?.baselineAt).toBeUndefined(); // 查不到時不建立基準
    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]);
    expect((await readItems()).get(id!)?.baselineAt).toBeDefined();
    await check([id!]);
    expect(createdList()).toHaveLength(0);
  });

  it('#1 data left by M3 (snapshot, no baselineAt): first check unavailable → no notification afterwards', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]);
    const items = await readItems();
    const { baselineAt: _, ...rest } = items.get(id!)!;
    items.set(id!, rest);
    await writeStore({ items, ruleState: new Map() });
    prices.delete(id!);
    await check([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]);
    await check([id!]);
    expect(createdList()).toHaveLength(0);
  });

  it('#2 setTarget while unavailable (last known price below the target) → no target notification on recovery', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 2000 });
    await check([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]);
    prices.delete(id!);
    await check([id!]);
    expect(await setTarget(id!, 1200)).toEqual({ ok: true });
    expect((await readRuleState()).get(ruleStateKey('work', id!, 'target'))?.active).toBe(true);
    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]);
    expect(createdList()).toHaveLength(1);
  });

  it('paused while already on sale and resumed while still on sale → no notification for the next two checks', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 2000 });
    await check([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]);
    expect(createdList()).toHaveLength(1);
    await setPaused(id!, true);
    setAll([id!], { price: 900, campaign: 'c2' }); // 暫停中換了一檔
    await setPaused(id!, false);
    await vi.waitFor(async () => expect((await readSnapshots()).get(id!)?.episode?.key).toBe('c2'));
    await whenIdle();
    await check([id!]);
    await check([id!]);
    expect(createdList()).toHaveLength(1);
  });

  it('a paused work in the same batch is skipped and its rule state is untouched', async () => {
    const list = ids(2);
    await seed(list);
    setAll(list, { price: 2000 });
    await check(list);
    const before = await readRuleState();
    const items = await readItems();
    items.set(list[1]!, { ...items.get(list[1]!)!, paused: true });
    await writeStore({ items });
    setAll(list, { price: 1000, campaign: 'c1' });
    await queue.startRun();
    await whenIdle();
    const after = await readRuleState();
    expect([...after.keys()].filter((k) => k.includes(list[1]!))).toEqual([...before.keys()].filter((k) => k.includes(list[1]!)));
    expect((await readSnapshots()).get(list[1]!)?.price).toBe(2000);
    expect((await readRecentNotifications())[0]?.ids).toEqual([list[0]]);
  });

  it('more than 100 works → two batches → two notifications (§4.2: batches are not merged)', async () => {
    const list = ids(101);
    await seed(list);
    setAll(list, { price: 2000 });
    await queue.startRun();
    await whenIdle();
    setAll(list, { price: 1000, campaign: 'c1' });
    await queue.startRun();
    await whenIdle();
    const recent = await readRecentNotifications();
    expect(recent.map((r) => r.ids.length).sort((a, b) => a - b)).toEqual([1, 100]);
    expect(createdList()).toHaveLength(2);
  });

  it('when a 4xx batch is split, each half that is written back gets its own notification (§4.2 v0.15)', async () => {
    const list = ids(4);
    const bad = list[1]!;
    await seed(list);
    setAll(list, { price: 2000 });
    await check(list);
    setAll(list, { price: 1000, campaign: 'c1' });
    apiGet.mockImplementation(async (key: string, p: { ids?: string[] }) =>
      key !== 'productInfo'
        ? { ok: false, kind: 'http', status: 404 }
        : p.ids!.includes(bad)
          ? { ok: false, kind: 'http', status: 403 }
          : { ok: true, status: 200, text: productFor(p.ids!) },
    );
    await check(list);
    // [a,b] 被拒、[c,d] 成功 → 通知 c、d；再拆 [a] 成功 → 通知 a；[b] 記成查不到
    const recent = await readRecentNotifications();
    expect(recent.map((r) => r.ids).reverse()).toEqual([[list[2], list[3]], [list[0]]]);
    expect(createdList()).toHaveLength(2);
    expect((await readSnapshots()).get(bad)?.available).toBe(false);
  });

  it('if the priceLog write fails after storage was written, nothing is notified (rather miss than duplicate)', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 2000 });
    await check([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    flags.failPriceLog = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await refreshPrices([id!]);
    await whenIdle();
    expect(createdList()).toHaveLength(0);
    // storage 已經寫入：最近的通知看得到、notified 有紀錄（之後不會重發）
    expect(await readRecentNotifications()).toHaveLength(1);
    flags.failPriceLog = false;
    await check([id!]);
    expect(createdList()).toHaveLength(0);
  });

  it('#4 ruleState keeps the newest entries over the limit and drops malformed keys', async () => {
    expect(isRuleStateKey(ruleStateKey('work', 'RJ01014447', 'sale'))).toBe(true);
    expect(isRuleStateKey(ruleStateKey('coupon', 'k1', 'couponExpiring'))).toBe(true);
    expect(isRuleStateKey('["work","RJ01014447","deeper"]')).toBe(false);
    expect(isRuleStateKey('["work","not-an-id","sale"]')).toBe(false);
    expect(isRuleStateKey('["work", "RJ01014447", "sale"]')).toBe(false); // 不是 JSON.stringify 的形式
    expect(isRuleStateKey('workRJ01014447sale')).toBe(false);
    const n = 20_001;
    const m = new Map(ids(n).map((id) => [ruleStateKey('work', id, 'sale'), { active: true }]));
    await writeStore({ ruleState: m });
    const got = await readRuleState();
    expect(got.size).toBe(20_000);
    expect(got.has(ruleStateKey('work', ids(1)[0]!, 'sale'))).toBe(false); // 最舊的被丟掉
    expect(got.has(ruleStateKey('work', ids(1, n)[0]!, 'sale'))).toBe(true); // 最新的留著
    await fakeBrowser.storage.local.set({ [STORAGE_KEYS.ruleState]: [['["work","RJ01014447","deeper"]', { active: true }]] });
    expect((await readRuleState()).size).toBe(0);
  });
});

describe('§4.2 cleanup and §6.1 notified retention', () => {
  it('untrack deletes the RuleState of the work', async () => {
    const [id] = ids(1);
    await seed([id!]);
    setAll([id!], { price: 1000, campaign: 'c1' });
    await check([id!]);
    expect((await readRuleState()).has(ruleStateKey('work', id!, 'sale'))).toBe(true);
    await untrackItem(id!);
    expect([...(await readRuleState()).keys()].some((k) => k.includes(id!))).toBe(false);
  });

  it('a scheduled run deletes notified keys older than 180 days', async () => {
    const DAY = 86_400_000;
    await writeStore({
      notified: new Map([
        ['["RJ00000001","sale","old"]', new Date(Date.now() - 181 * DAY).toISOString()],
        ['["RJ00000001","sale","new"]', new Date(Date.now() - 179 * DAY).toISOString()],
      ]),
    });
    await queue.startRun();
    await whenIdle();
    expect([...(await readNotified()).keys()]).toEqual(['["RJ00000001","sale","new"]']);
  });
});

describe('§3.6 DLWatcher auto-pause notification', () => {
  it('creates a system notification and a recent notification when DLWatcher is auto-paused', async () => {
    const MIN = 60_000;
    await seed(ids(1));
    setAll(ids(1), { price: 2000 });
    apiGet.mockImplementation(async (key: string, p: { ids?: string[] }) =>
      key === 'productInfo' ? { ok: true, status: 200, text: productFor(p.ids!) } : { ok: true, status: 200, text: '{"broken":true}' },
    );
    await writeStore({
      dlwatcherHealth: {
        allFailingSince: new Date(Date.now() - 7 * 1440 * MIN - MIN).toISOString(),
        lastFailureAt: new Date(Date.now() - MIN).toISOString(),
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await queue.startRun();
    await whenIdle();
    expect((await readSettings()).dlwatcherAutoPausedAt).toBeDefined();
    const all = createdList();
    expect(all).toHaveLength(1);
    expect(all[0]![1]).toMatchObject({ title: 'DL_Assistant：DLWatcher 已暫停', message: expect.stringContaining('已改用自己的紀錄') });
    const recent = await readRecentNotifications();
    expect(recent[0]).toMatchObject({ notificationId: all[0]![0], ids: [], rules: ['dlwatcherPaused'] });
    // 點擊：沒有對象，只關掉
    const tabsCreate = vi.spyOn(fakeBrowser.tabs, 'create');
    await handleNotificationClick(all[0]![0]);
    expect(tabsCreate).not.toHaveBeenCalled();
    expect(createdList()).toHaveLength(0);
  });
});

describe('§6.2 text helpers', () => {
  it('sanitizeForNotification: control chars become spaces, format chars are removed, whitespace collapses', () => {
    expect(sanitizeForNotification('作品名\n第2巻')).toBe('作品名 第2巻');
    expect(sanitizeForNotification('a\tb\u2028c\u2029d')).toBe('a b c d');
    expect(sanitizeForNotification('\u202Egnp.exe\u200B\u200D x  ')).toBe('gnp.exe x');
    expect(sanitizeForNotification('  ')).toBe('');
  });

  it('truncates to 60 characters without splitting surrogate pairs', () => {
    const s = '😀'.repeat(70);
    const out = sanitizeForNotification(s);
    expect(Array.from(out)).toHaveLength(60);
    expect(out).toBe('😀'.repeat(60));
  });

  it('formats yen with thousands separators', () => {
    expect(formatYen(0)).toBe('¥0');
    expect(formatYen(1980)).toBe('¥1,980');
    expect(formatYen(1234567)).toBe('¥1,234,567');
  });

  it('summarizes merged notifications and lists at most 3 works', () => {
    const snap = (id: string) => ({
      id,
      available: true,
      price: 1000,
      officialPrice: 2000,
      isDiscount: true,
      discountRate: 50,
      pointRate: 1,
      couponFacts: { siteId: 'home', workType: 'SOU', customGenres: [], noReduction: false },
      checkedAt: '2026-11-23T00:00:00.000Z',
    });
    const works = ids(5).map((id, i) => ({
      id,
      title: `作品${i}`,
      snapshot: snap(id),
      rules: i === 0 ? (['sale', 'lowest'] as const) : (['sale'] as const),
      lowestBaseline: undefined,
    }));
    const n = buildWorkNotice(
      works.map((w) => ({ ...w, rules: [...w.rules] })),
      false,
    );
    expect(n.title).toBe('DL_Assistant：特價、史低');
    expect(n.message).toBe('5 個追蹤作品正在特價\n・作品0 ¥1,000\n・作品1 ¥1,000\n・作品2 ¥1,000\n…還有 2 件');
    const mixed = buildWorkNotice(
      [
        { ...works[0]!, rules: ['ending'] },
        { ...works[1]!, rules: ['target'] },
      ],
      true,
    );
    expect(mixed).toEqual({ title: 'DL_Assistant：低於目標價、即將截止', message: '2 個追蹤作品有新的優惠', rules: ['target', 'ending'] });
  });
});
