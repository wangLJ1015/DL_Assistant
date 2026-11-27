import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  type PriceLogEntry,
  type PriceSnapshot,
  type RuleState,
  type TrackedItem,
  type WorkRule,
} from '../src/lib/models';
import { nextPriceLogEntry, observationFromSnapshot } from '../src/lib/price-log';
import {
  decideEpisode,
  evaluateWork,
  isOnSale,
  lowestBaseline,
  previousLowest,
  ruleStateKey,
  targetStateFor,
  workDedupKey,
  type DlwatcherPeriods,
} from '../src/lib/rules';

const NOW = Date.parse('2026-11-23T03:00:00.000Z');
const base: PriceSnapshot = {
  id: 'RJ01014447',
  available: true,
  price: 1386,
  officialPrice: 1980,
  isDiscount: true,
  discountRate: 30,
  discountEnd: '2026-11-28T14:59:59.000Z',
  pointRate: 1,
  couponFacts: { siteId: 'home', workType: 'SOU', customGenres: [], noReduction: false },
  checkedAt: '2026-11-23T03:00:00.000Z',
};

describe('§6 isOnSale', () => {
  it('is true for an available discount that has not ended', () => {
    expect(isOnSale(base, NOW)).toBe(true);
    const { discountEnd: _, ...noEnd } = base;
    expect(isOnSale(noEnd, NOW)).toBe(true);
  });
  it.each<[string, Partial<PriceSnapshot>]>([
    ['unavailable', { available: false }],
    ['not discounted', { isDiscount: false }],
    ['stale end date (§5.5 step 4)', { discountEndStale: true }],
    ['ended', { discountEnd: '2026-11-23T02:59:59.000Z' }],
    ['ends exactly now', { discountEnd: '2026-11-23T03:00:00.000Z' }],
  ])('is false when %s', (_, patch) => {
    expect(isOnSale({ ...base, ...patch }, NOW)).toBe(false);
  });
});

// ---- §6.1 依序處理：用一個小模擬器跑連續幾次查價（和 price-check.ts 的寫入方式相同）----

const ID = 'RJ01014447';
const HOUR = 3_600_000;
const T0 = Date.parse('2026-12-01T00:00:00.000Z');
const at = (h: number) => new Date(T0 + h * HOUR).toISOString();

const regular = (price = 2000): Partial<PriceSnapshot> => ({
  price,
  officialPrice: 2000,
  isDiscount: false,
  discountRate: 0,
  discountEnd: undefined,
  campaignId: undefined,
});
const sale = (price: number, extra: Partial<PriceSnapshot> = {}): Partial<PriceSnapshot> => ({
  price,
  officialPrice: 2000,
  isDiscount: true,
  discountRate: Math.round((1 - price / 2000) * 100),
  discountEnd: undefined,
  campaignId: undefined,
  ...extra,
});
const UNAVAILABLE = 'unavailable' as const;

function makeSim(opts: { targetPrice?: number; dlwatcherLowest?: number; rules?: Partial<Record<WorkRule, boolean>> } = {}) {
  let dlwatcher: DlwatcherPeriods | undefined =
    opts.dlwatcherLowest === undefined
      ? undefined
      : { lowest: { price: opts.dlwatcherLowest, start: '2024-01-01T00:00:00.000Z', end: '2024-01-10T00:00:00.000Z' }, sales: [] };
  let lastLowestBaseline: number | undefined;
  let item: TrackedItem = {
    id: ID,
    site: 'home',
    title: 'テスト作品',
    imageUrl: '',
    addedAt: at(0),
    source: 'manual',
    autoAdded: false,
    paused: false,
    ...(opts.targetPrice !== undefined ? { targetPrice: opts.targetPrice } : {}),
  };
  let prev: PriceSnapshot | undefined;
  const ruleState = new Map<string, RuleState>();
  const notified = new Map<string, string>();
  const log: PriceLogEntry[] = [];
  const rules: Record<WorkRule | 'couponExpiring', boolean> = { ...defaultSettings().rules, ...opts.rules };

  /** 一次查價；回傳這次要通知的規則（排序後）。 */
  function check(h: number, patch: Partial<PriceSnapshot> | typeof UNAVAILABLE): WorkRule[] {
    const now = at(h);
    let snap: PriceSnapshot;
    if (patch === UNAVAILABLE) {
      if (!prev) throw new Error('no previous snapshot');
      snap = { ...prev, available: false, checkedAt: now };
    } else {
      snap = { ...base, id: ID, available: true, ...patch, checkedAt: now };
      for (const k of Object.keys(snap) as (keyof PriceSnapshot)[]) if (snap[k] === undefined) delete snap[k];
      if (prev?.episode) snap.episode = { ...prev.episode };
    }
    const ev = evaluateWork({
      item,
      prev,
      snap,
      now,
      dlwatcher,
      log: [...log],
      ruleState,
      rules,
      notified,
    });
    prev = ev.snapshot;
    lastLowestBaseline = ev.lowestBaseline;
    for (const [k, v] of ev.ruleState) {
      if (v) ruleState.set(k, v);
      else ruleState.delete(k);
    }
    if (ev.baseline) item = { ...item, baselineAt: now };
    for (const hit of ev.hits) notified.set(hit.dedupKey, now);
    const next = nextPriceLogEntry(log.at(-1), observationFromSnapshot(ev.snapshot), 12 * HOUR);
    if (next?.isNew) log.push(next.entry);
    else if (next) log[log.length - 1] = next.entry;
    return ev.hits.map((x) => x.rule).sort();
  }
  return {
    check,
    get snapshot() {
      return prev;
    },
    get item() {
      return item;
    },
    /** 最近一次查價算出的「這段優惠之前的最低價」（通知內文用）。 */
    get lowestBaseline() {
      return lastLowestBaseline;
    },
    ruleState,
    notified,
    setDlwatcher(d: DlwatcherPeriods | undefined) {
      dlwatcher = d;
    },
    setRule(rule: WorkRule, on: boolean) {
      rules[rule] = on;
    },
    /** priceLog 遺失（IndexedDB 被清掉、寫入失敗）。 */
    clearLog() {
      log.length = 0;
    },
    pause() {
      item = { ...item, paused: true };
    },
    /** 恢復追蹤：清掉 baselineAt（§5.3）。 */
    resume() {
      const { baselineAt: _, ...rest } = item;
      item = { ...rest, paused: false };
    },
    setTarget(price: number) {
      item = { ...item, targetPrice: price };
      const key = ruleStateKey('work', ID, 'target');
      const st = targetStateFor(prev, price, ruleState.get(key), at(0));
      if (st) ruleState.set(key, st);
      else ruleState.delete(key);
    },
  };
}

describe('§6.1 processing steps (unit tests listed in the spec)', () => {
  it('already on sale when added → no notification for the next two checks; ends and restarts → notifies', () => {
    const s = makeSim();
    expect(s.check(0, sale(1000, { campaignId: 'c1' }))).toEqual([]); // 建立基準
    expect(s.item.baselineAt).toBe(at(0));
    expect(s.check(6, sale(1000, { campaignId: 'c1' }))).toEqual([]);
    expect(s.check(12, sale(1000, { campaignId: 'c1' }))).toEqual([]);
    expect(s.check(18, regular())).toEqual([]);
    expect(s.snapshot?.episode).toBeUndefined();
    expect(s.check(24, sale(1000, { campaignId: 'c2' }))).toEqual(['lowest', 'sale']);
  });

  it('regular ¥2,000 → c1 ¥1,000 notifies sale+lowest; c2 ¥800 right after notifies sale+lowest again', () => {
    const s = makeSim();
    expect(s.check(0, regular())).toEqual([]);
    expect(s.check(6, sale(1000, { campaignId: 'c1' }))).toEqual(['lowest', 'sale']);
    expect(s.snapshot?.episode).toEqual({ key: 'c1', startedAt: at(6) });
    // 一檔活動結束、下一檔馬上開始，中間沒看到原價
    expect(s.check(12, sale(800, { campaignId: 'c2' }))).toEqual(['lowest', 'sale']);
    expect(s.snapshot?.episode).toEqual({ key: 'c2', startedAt: at(12) });
  });

  it('cached data that already ended (§5.5 step 3) → onSale false, no sale', () => {
    const s = makeSim();
    s.check(0, regular());
    // is_discount 還是 true，但 discountEnd 已經過了
    expect(s.check(6, sale(1000, { campaignId: 'c1', discountEnd: at(5) }))).toEqual([]);
    expect(s.snapshot?.episode).toBeUndefined();
    expect(s.check(12, sale(1000, { discountEndStale: true }))).toEqual([]);
  });

  it('a discount without campaignId or discountEnd: unavailable once, back the next day → no re-notification', () => {
    const s = makeSim();
    s.check(0, regular());
    expect(s.check(6, sale(1000))).toEqual(['lowest', 'sale']);
    const episode = s.snapshot?.episode;
    expect(episode?.key).toBe('start:2026-12-01');
    expect(s.check(12, UNAVAILABLE)).toEqual([]);
    expect(s.snapshot?.episode).toEqual(episode); // 保留，不清掉
    expect(s.check(36, sale(1000))).toEqual([]); // 隔天
    expect(s.snapshot?.episode).toEqual(episode);
  });

  it('(v0.15) added while on sale, unavailable once, back → still no notification', () => {
    const s = makeSim();
    expect(s.check(0, sale(1000))).toEqual([]); // 建立基準：notified 沒有紀錄
    expect(s.check(6, UNAVAILABLE)).toEqual([]);
    expect(s.check(30, sale(1000))).toEqual([]);
  });

  it('while unavailable, onSale is false (dashboard, popup and planner do not show "on sale")', () => {
    const s = makeSim();
    s.check(0, sale(1000));
    s.check(6, UNAVAILABLE);
    expect(s.snapshot!.isDiscount).toBe(true); // 價格欄位沿用上一次
    expect(isOnSale(s.snapshot!, Date.parse(at(6)))).toBe(false);
  });

  it('raising the target price above the current price during a sale → no target notification', () => {
    const s = makeSim();
    s.check(0, regular());
    expect(s.check(6, sale(1000, { campaignId: 'c1' }))).toEqual(['lowest', 'sale']);
    s.setTarget(1200);
    expect(s.ruleState.get(ruleStateKey('work', ID, 'target'))?.active).toBe(true);
    expect(s.check(12, sale(1000, { campaignId: 'c1' }))).toEqual([]);
    expect(s.check(18, sale(1000, { campaignId: 'c1' }))).toEqual([]);
  });

  it('paused and resumed while on sale → no notification for the next two checks', () => {
    const s = makeSim();
    s.check(0, regular());
    s.pause();
    // 暫停中不查價
    s.resume();
    expect(s.check(48, sale(1000, { campaignId: 'c1' }))).toEqual([]); // 重新建立基準
    expect(s.item.baselineAt).toBe(at(48));
    expect(s.check(54, sale(1000, { campaignId: 'c1' }))).toEqual([]);
  });
});

describe('§6.1 episode (step 3)', () => {
  it('starts a new episode when campaignId is empty and discountEnd moves more than 7 days later', () => {
    const s = makeSim();
    s.check(0, regular());
    expect(s.check(6, sale(1000, { discountEnd: at(24 * 5) }))).toEqual(['lowest', 'sale']);
    expect(s.snapshot?.episode?.key).toBe(at(24 * 5));
    // 延長 7 天以內：同一段
    expect(s.check(12, sale(1000, { discountEnd: at(24 * 12) }))).toEqual([]);
    // 再延長超過 7 天：新的一段
    expect(s.check(18, sale(1000, { discountEnd: at(24 * 20) }))).toEqual(['lowest', 'sale']);
    expect(s.snapshot?.episode).toEqual({ key: at(24 * 20), startedAt: at(18) });
  });

  it('keeps the episode while campaignId stays the same even if discountEnd moves', () => {
    const s = makeSim();
    s.check(0, regular());
    s.check(6, sale(1000, { campaignId: 'c1', discountEnd: at(24 * 3) }));
    expect(s.check(12, sale(1000, { campaignId: 'c1', discountEnd: at(24 * 30) }))).toEqual([]);
    expect(s.snapshot?.episode?.key).toBe('c1');
  });

  it('clears the episode after more than 7 days of being unavailable; back on sale is a new episode', () => {
    const s = makeSim();
    s.check(0, regular());
    expect(s.check(6, sale(1000))).toEqual(['lowest', 'sale']);
    s.check(12, UNAVAILABLE);
    expect(s.snapshot?.episode).toBeDefined();
    s.check(6 + 24 * 7 + 1, UNAVAILABLE);
    expect(s.snapshot?.episode).toBeUndefined();
    // 新的一段優惠；和之前的特價同價也算 lowest（§6：現價 ≤ 史低基準）
    expect(s.check(6 + 24 * 8, sale(1000))).toEqual(['lowest', 'sale']);
  });

  it('decideEpisode: unavailable without a previous episode stays empty', () => {
    const prev = { ...base, isDiscount: false };
    expect(decideEpisode(prev, { ...prev, available: false }, false, [], base.checkedAt)).toEqual({ episode: undefined, isNew: false });
  });
});

describe('§6.1 conditions (step 4)', () => {
  it('lowest baseline excludes the current episode and unavailable records', () => {
    const log: PriceLogEntry[] = [
      { id: ID, price: 2000, officialPrice: 2000, isDiscount: false, discountRate: 0, at: at(0), lastSeenAt: at(5) },
      { id: ID, price: 500, officialPrice: 2000, isDiscount: true, discountRate: 75, at: at(6), lastSeenAt: at(6), status: 'unavailable' },
      { id: ID, price: 1000, officialPrice: 2000, isDiscount: true, discountRate: 50, at: at(12), lastSeenAt: at(12) },
    ];
    expect(lowestBaseline(undefined, log, at(12))).toBe(2000);
    expect(lowestBaseline(undefined, log, at(13))).toBe(1000);
    expect(lowestBaseline(1500, log, at(12))).toBe(1500);
    expect(lowestBaseline(undefined, [], at(12))).toBeUndefined();
  });

  it('lowest does not hold without any previous record or DLWatcher data', () => {
    const s = makeSim();
    s.check(0, sale(1000)); // 基準（沒有之前的紀錄）
    expect(s.ruleState.has(ruleStateKey('work', ID, 'lowest'))).toBe(false);
    expect(s.ruleState.get(ruleStateKey('work', ID, 'sale'))).toEqual({ active: true, since: at(0) });
  });

  it('uses the DLWatcher lowest: a sale above it is not a lowest', () => {
    const s = makeSim({ dlwatcherLowest: 800 });
    s.check(0, regular());
    expect(s.check(6, sale(1000, { campaignId: 'c1' }))).toEqual(['sale']);
    expect(s.check(12, sale(800, { campaignId: 'c2' }))).toEqual(['lowest', 'sale']);
  });

  it('ending: notifies once when the end is within 24 hours, re-arms for a new episode', () => {
    const s = makeSim();
    s.check(0, regular());
    expect(s.check(6, sale(1000, { campaignId: 'c1', discountEnd: at(48) }))).toEqual(['lowest', 'sale']);
    expect(s.check(30, sale(1000, { campaignId: 'c1', discountEnd: at(48) }))).toEqual(['ending']);
    expect(s.check(36, sale(1000, { campaignId: 'c1', discountEnd: at(48) }))).toEqual([]);
    expect(s.check(42, sale(1000, { campaignId: 'c2', discountEnd: at(60) }))).toEqual(['ending', 'lowest', 'sale']);
  });

  it('target: notifies when the price drops to the target, not again while it stays there', () => {
    const s = makeSim({ targetPrice: 1500 });
    s.check(0, regular());
    expect(s.check(6, sale(1400, { campaignId: 'c1' }))).toEqual(['lowest', 'sale', 'target']);
    expect(s.check(12, sale(1400, { campaignId: 'c1' }))).toEqual([]);
    // 新的一段優惠：target 不重設（它看的是價格）
    expect(s.check(18, sale(1400, { campaignId: 'c2' }))).toEqual(['lowest', 'sale']);
    expect(s.check(24, regular())).toEqual([]);
    expect(s.check(30, regular(1500))).toEqual(['target']); // 原價調降到目標價
  });

  it('a disabled rule updates its state but does not notify; enabling it later does not notify an ongoing sale', () => {
    const s = makeSim({ rules: { sale: false } });
    s.check(0, regular());
    expect(s.check(6, sale(1000, { campaignId: 'c1' }))).toEqual(['lowest']);
    expect(s.ruleState.get(ruleStateKey('work', ID, 'sale'))?.active).toBe(true);
    // 進行中的特價途中重新開啟：已經成立，不發（M4 審查：原本沒有測到這一半）
    s.setRule('sale', true);
    expect(s.check(12, sale(1000, { campaignId: 'c1' }))).toEqual([]);
    // 下一段優惠照常通知
    expect(s.check(18, sale(1000, { campaignId: 'c2' }))).toEqual(['lowest', 'sale']);
  });

  it('deduplicates by the notified key even if the state flips', () => {
    const s = makeSim();
    s.check(0, regular());
    expect(s.check(6, sale(1000, { campaignId: 'c1' }))).toEqual(['lowest', 'sale']);
    s.ruleState.clear(); // 例如 ruleState 遺失
    expect(s.check(12, sale(1000, { campaignId: 'c1' }))).toEqual([]);
  });
});

describe('§6 keys', () => {
  it('builds keys with JSON.stringify, not string concatenation', () => {
    expect(ruleStateKey('work', ID, 'sale')).toBe('["work","RJ01014447","sale"]');
    expect(workDedupKey(ID, 'sale', 'c1', undefined, at(0))).toBe('["RJ01014447","sale","c1"]');
    expect(workDedupKey(ID, 'target', undefined, 1500, at(0))).toBe('["RJ01014447","target",1500,"2026-12-01"]');
    expect(workDedupKey(ID, 'target', 'c1', 1500, at(0))).toBe('["RJ01014447","target",1500,"c1"]');
    expect(workDedupKey(ID, 'lowest', '1', undefined, at(0))).not.toBe(workDedupKey(ID, 'lowest', '1"', undefined, at(0)));
  });

  it('targetStateFor keeps since while still active, clears when not', () => {
    expect(targetStateFor(base, 1500, undefined, at(1))).toEqual({ active: true, since: at(1) });
    expect(targetStateFor(base, 1500, { active: true, since: at(0) }, at(1))).toEqual({ active: true, since: at(0) });
    expect(targetStateFor(base, 1000, undefined, at(1))).toBeUndefined();
    // v0.16：查不到時用最後一次知道的價格（快照沿用的價格欄位）
    expect(targetStateFor({ ...base, available: false }, 1500, undefined, at(1))).toEqual({ active: true, since: at(1) });
    expect(targetStateFor({ ...base, available: false }, 1000, undefined, at(1))).toBeUndefined();
    expect(targetStateFor(base, undefined, undefined, at(1))).toBeUndefined();
    expect(targetStateFor(undefined, 1500, undefined, at(1))).toBeUndefined();
  });
});

describe('M4 review fixes (v0.16)', () => {
  it('#1 no baseline yet and unavailable: does not establish the baseline; the next available check does', () => {
    const s = makeSim();
    s.check(0, sale(1000, { campaignId: 'c1' })); // 加入時已在打折
    s.pause();
    s.resume(); // baselineAt 清掉
    expect(s.check(6, UNAVAILABLE)).toEqual([]);
    expect(s.item.baselineAt).toBeUndefined();
    // 規則狀態不動（不記成不成立）
    expect(s.ruleState.get(ruleStateKey('work', ID, 'sale'))?.active).toBe(true);
    expect(s.check(12, sale(1000, { campaignId: 'c1' }))).toEqual([]); // 這次才建立基準
    expect(s.item.baselineAt).toBe(at(12));
    expect(s.check(18, sale(1000, { campaignId: 'c1' }))).toEqual([]);
  });

  it('#2 setTarget while unavailable uses the last known price → no target notification on recovery', () => {
    const s = makeSim();
    s.check(0, regular());
    expect(s.check(6, sale(1000, { campaignId: 'c1' }))).toEqual(['lowest', 'sale']);
    s.check(12, UNAVAILABLE);
    s.setTarget(1200);
    expect(s.ruleState.get(ruleStateKey('work', ID, 'target'))?.active).toBe(true);
    expect(s.check(18, sale(1000, { campaignId: 'c1' }))).toEqual([]);
    // 恢復時價格已經高於目標價：不成立；之後降到目標價才通知
    s.check(24, UNAVAILABLE);
    s.check(30, regular());
    expect(s.ruleState.has(ruleStateKey('work', ID, 'target'))).toBe(false);
    expect(s.check(36, sale(1100, { campaignId: 'c2' }))).toEqual(['sale', 'target']);
  });

  it('#3 the text baseline excludes DLWatcher periods that overlap the current episode', () => {
    const s = makeSim();
    s.check(0, regular());
    // DLWatcher：過去的史低 ¥1,200；這段優惠（¥900）開始後才更新，史低已經是這段的 ¥900
    s.setDlwatcher({
      lowest: { price: 900, start: at(5), end: at(11) },
      sales: [
        { price: 900, rate: 55, start: at(5), end: at(11) },
        { price: 1200, rate: 40, start: '2025-01-01T00:00:00.000Z', end: '2025-01-10T00:00:00.000Z' },
      ],
    });
    expect(s.check(6, sale(900, { campaignId: 'c1' }))).toEqual(['lowest', 'sale']);
    expect(s.lowestBaseline).toBe(1200); // 不是 900（「和史低同價」）
    expect(previousLowest(undefined, [], at(6))).toBeUndefined();
    // 沒有 episode（不在打折）時全部的期間都算
    expect(previousLowest({ lowest: { price: 900, start: at(5), end: at(11) }, sales: [] }, [], undefined)).toBe(900);
  });

  it('#5 an episode survives the first unavailable check even when the priceLog is empty', () => {
    const s = makeSim();
    s.check(0, regular());
    expect(s.check(6, sale(1000))).toEqual(['lowest', 'sale']);
    s.clearLog();
    s.check(12, UNAVAILABLE);
    expect(s.snapshot?.episode?.key).toBe('start:2026-12-01');
    expect(s.check(18, sale(1000))).toEqual([]);
    // episode 開始後超過 7 天都查不到才清掉
    s.clearLog();
    s.check(18 + 1, UNAVAILABLE);
    s.clearLog();
    s.check(6 + 24 * 7 + 1, UNAVAILABLE);
    expect(s.snapshot?.episode).toBeUndefined();
  });
});
