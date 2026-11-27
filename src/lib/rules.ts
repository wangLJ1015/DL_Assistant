// 通知規則與「打折中」的判斷（§6）。純函式：background 的查價流程（price-check.ts）呼叫，單元測試照 §6.1 的步驟寫。
import { isoToMs, jstDate } from './dates';
import {
  WORK_RULES,
  type HistoryRecord,
  type PriceLogEntry,
  type PriceSnapshot,
  type RuleState,
  type Settings,
  type TrackedItem,
  type WorkRule,
} from './models';

const DAY_MS = 24 * 60 * 60 * 1000;
/** §6.1 第 3 步：連續查不到超過這個時間才清掉 episode。 */
export const EPISODE_UNAVAILABLE_KEEP_MS = 7 * DAY_MS;
/** §6.1 第 3 步：沒有 campaignId 時，discountEnd 往後延超過這個時間就算新的一段優惠。 */
export const EPISODE_END_EXTEND_MS = 7 * DAY_MS;
/** §6 `ending`：離截止不到這個時間。 */
export const ENDING_WITHIN_MS = DAY_MS;

/**
 * §6：儀表板、試算、popup 說的「打折中」一律用這個函式。
 * onSale = available && isDiscount && !discountEndStale && !(discountEnd && discountEnd ≤ now)
 */
export function isOnSale(s: PriceSnapshot, nowMs: number): boolean {
  if (!s.available || !s.isDiscount || s.discountEndStale) return false;
  if (s.discountEnd !== undefined && isoToMs(s.discountEnd) <= nowMs) return false;
  return true;
}

/** `ruleState` 的 key（§5.3）：JSON.stringify([對象種類, 對象編號, rule])。 */
export function ruleStateKey(kind: 'work' | 'coupon', id: string, rule: string): string {
  return JSON.stringify([kind, id, rule]);
}

/** 作品的去重 key（§6 規則表）。不直接串接字串（§6.1 第 8 步）。 */
export function workDedupKey(
  id: string,
  rule: WorkRule,
  episodeKey: string | undefined,
  targetPrice: number | undefined,
  nowIso: string,
): string {
  if (rule === 'target') return JSON.stringify([id, 'target', targetPrice ?? null, episodeKey ?? jstDate(nowIso)]);
  return JSON.stringify([id, rule, episodeKey ?? null]);
}

/** 自己的紀錄裡最後一次查得到（status 為空）的時間。 */
function lastAvailableSeenAt(log: readonly PriceLogEntry[]): number | undefined {
  let t: number | undefined;
  for (const e of log) {
    if (e.status !== undefined) continue;
    const ms = isoToMs(e.lastSeenAt);
    if (t === undefined || ms > t) t = ms;
  }
  return t;
}

export type EpisodeDecision = { episode: PriceSnapshot['episode']; isNew: boolean };

/**
 * §6.1 第 3 步：決定這次的 `episode`。
 * - 查不到 → 保留上次的（連續查不到超過 7 天才清掉）。
 * - 查得到但沒在打折 → 清掉。
 * - 打折中，而且上次沒有 episode、campaignId 兩邊都有值而且不同、或 campaignId 為空而且 discountEnd 往後延超過 7 天 → 新的一段優惠。
 * - 其他情況沿用。
 */
export function decideEpisode(
  prev: PriceSnapshot | undefined,
  s: PriceSnapshot,
  onSale: boolean,
  log: readonly PriceLogEntry[],
  nowIso: string,
): EpisodeDecision {
  const nowMs = isoToMs(nowIso);
  const prevEpisode = prev?.episode;
  if (!s.available) {
    if (!prevEpisode) return { episode: undefined, isNew: false };
    // 最後一次查得到的時間：priceLog 與 episode 開始的時間取晚的（v0.16：priceLog 遺失或寫入失敗時，
    // 不能第一次查不到就清掉 episode；episode 開始時一定查得到）。
    const seen = Math.max(lastAvailableSeenAt(log) ?? -Infinity, isoToMs(prevEpisode.startedAt));
    if (nowMs - seen > EPISODE_UNAVAILABLE_KEEP_MS) return { episode: undefined, isNew: false };
    return { episode: { ...prevEpisode }, isNew: false };
  }
  if (!onSale) return { episode: undefined, isNew: false };
  const campaignChanged = prev?.campaignId !== undefined && s.campaignId !== undefined && prev.campaignId !== s.campaignId;
  const endExtended =
    s.campaignId === undefined &&
    prev?.discountEnd !== undefined &&
    s.discountEnd !== undefined &&
    isoToMs(s.discountEnd) - isoToMs(prev.discountEnd) > EPISODE_END_EXTEND_MS;
  if (!prevEpisode || campaignChanged || endExtended) {
    return { episode: { key: s.campaignId ?? s.discountEnd ?? `start:${jstDate(nowIso)}`, startedAt: nowIso }, isNew: true };
  }
  return { episode: { ...prevEpisode }, isNew: false };
}

/**
 * §6.1 第 4 步：`lowest` 的史低基準 = min(DLWatcher 史低, 自己紀錄中 `at` 早於 `episode.startedAt` 的最低價)，
 * 只計算 status 為空的紀錄。這次的價格不算進去（`log` 是這次寫入之前的紀錄）。都沒有時回傳 undefined。
 */
export function lowestBaseline(
  dlwatcherLowest: number | undefined,
  log: readonly PriceLogEntry[],
  episodeStartedAt: string | undefined,
): number | undefined {
  const before = episodeStartedAt === undefined ? Infinity : isoToMs(episodeStartedAt);
  let best = dlwatcherLowest;
  for (const e of log) {
    if (e.status !== undefined || isoToMs(e.at) >= before) continue;
    if (best === undefined || e.price < best) best = e.price;
  }
  return best;
}

/** DLWatcher 的史低與最近的特價（§5.3 HistoryRecord 的一部分）。 */
export type DlwatcherPeriods = Pick<HistoryRecord, 'lowest' | 'sales'>;

/**
 * 通知內文「和史低差多少」用的、這段優惠之前的最低價（v0.16）。DLWatcher 的史低與最近特價會包含進行中的這段優惠
 * （§5.2：進行中特價的 end 是最後看到的時間），所以 `end ≥ episode.startedAt` 的期間不算；自己的紀錄同第 4 步。
 * 只影響內文，規則的條件照第 4 步（用 ≤ 比較，含不含這段優惠結果相同）。
 */
export function previousLowest(
  dlwatcher: DlwatcherPeriods | undefined,
  log: readonly PriceLogEntry[],
  episodeStartedAt: string | undefined,
): number | undefined {
  const before = episodeStartedAt === undefined ? Infinity : isoToMs(episodeStartedAt);
  let best: number | undefined;
  const periods = dlwatcher ? [...(dlwatcher.lowest ? [dlwatcher.lowest] : []), ...dlwatcher.sales] : [];
  for (const p of periods) {
    if (isoToMs(p.end) >= before) continue;
    if (best === undefined || p.price < best) best = p.price;
  }
  const own = lowestBaseline(undefined, log, episodeStartedAt);
  if (own !== undefined && (best === undefined || own < best)) best = own;
  return best;
}

export interface WorkEvalInput {
  item: TrackedItem;
  /** 上一次的快照（決定 episode 用）。 */
  prev: PriceSnapshot | undefined;
  /** 這次的快照（§6.1 第 1 步；episode 由這裡重新決定）。 */
  snap: PriceSnapshot;
  now: string;
  /** DLWatcher 使用中而且有資料時的史低與最近特價（§3.6）；關閉、暫停或沒有資料時是 undefined。 */
  dlwatcher: DlwatcherPeriods | undefined;
  /** 這次寫入之前的自己的紀錄。 */
  log: readonly PriceLogEntry[];
  ruleState: ReadonlyMap<string, RuleState>;
  rules: Settings['rules'];
  /** 已送出的通知的去重 key。 */
  notified: { has(key: string): boolean };
}

export interface WorkHit {
  rule: WorkRule;
  dedupKey: string;
}

export interface WorkEvalResult {
  /** episode 已決定的快照。 */
  snapshot: PriceSnapshot;
  /** 這件作品 4 條規則的新狀態；undefined 代表不成立（從 ruleState 刪掉）。 */
  ruleState: Map<string, RuleState | undefined>;
  /** true：這次只建立基準（§6.1 第 6 步），呼叫端要設定 baselineAt。 */
  baseline: boolean;
  /** 要通知的規則（已去重）。 */
  hits: WorkHit[];
  /** 這段優惠之前的最低價（通知內文「和史低差多少」用，previousLowest）。 */
  lowestBaseline: number | undefined;
}

/** §6.1 第 2～8 步：一件作品這次查價後的 episode、規則狀態與要通知的規則。 */
export function evaluateWork(input: WorkEvalInput): WorkEvalResult {
  const { item, snap, now } = input;
  const nowMs = isoToMs(now);
  // 2. onSale（查不到時一定是 false）
  const onSale = isOnSale(snap, nowMs);
  // 3. episode
  const { episode, isNew } = decideEpisode(input.prev, snap, onSale, input.log, now);
  const snapshot: PriceSnapshot = { ...snap };
  if (episode) snapshot.episode = episode;
  else delete snapshot.episode;
  // 6（先判斷）. 沒有基準而且這次查不到：還不知道現在的狀態，不建立基準、規則狀態不動、不通知（v0.16，M4 審查）。
  // 否則「恢復追蹤時已在打折，恢復後那一次剛好查不到」會把 4 條規則記成不成立，下一次查到就發出 sale。
  if (item.baselineAt === undefined && !snap.available) {
    return { snapshot, ruleState: new Map(), baseline: false, hits: [], lowestBaseline: undefined };
  }
  // 4. 每條規則的條件
  const baselinePrice = lowestBaseline(input.dlwatcher?.lowest?.price, input.log, episode?.startedAt);
  const active: Record<WorkRule, boolean> = {
    sale: onSale,
    target: snap.available && item.targetPrice !== undefined && snap.price <= item.targetPrice,
    lowest: onSale && baselinePrice !== undefined && snap.price <= baselinePrice,
    ending: onSale && snap.discountEnd !== undefined && isoToMs(snap.discountEnd) - nowMs <= ENDING_WITHIN_MS,
  };
  // 5. 新的一段優惠時，sale、lowest、ending 的上次結果視為不成立（target 看價格，不重設）
  const wasActive = (rule: WorkRule): RuleState | undefined => {
    if (isNew && rule !== 'target') return undefined;
    const st = input.ruleState.get(ruleStateKey('work', item.id, rule));
    return st?.active ? st : undefined;
  };
  const ruleState = new Map<string, RuleState | undefined>();
  const hits: WorkHit[] = [];
  const baseline = item.baselineAt === undefined;
  for (const rule of WORK_RULES) {
    const prevState = wasActive(rule);
    const key = ruleStateKey('work', item.id, rule);
    // 查不到：不知道現在的狀態，維持上次的結果（v0.15）。否則「加入時已在打折（建立基準、沒有通知、notified 沒有紀錄）
    // → 查不到一次 → 恢復」會在恢復時發出 sale。（沒有基準時查不到的情況在上面已經先回傳。）
    if (!snap.available) {
      ruleState.set(key, input.ruleState.get(key));
      continue;
    }
    if (!active[rule]) {
      ruleState.set(key, undefined);
      continue;
    }
    ruleState.set(key, { active: true, since: prevState?.since ?? now });
    // 6. 建立基準時不通知；7. 規則開啟、條件成立、上次不成立 → 候選
    if (baseline || prevState || !input.rules[rule]) continue;
    // 8. 去重
    const dedupKey = workDedupKey(item.id, rule, episode?.key, item.targetPrice, now);
    if (!input.notified.has(dedupKey)) hits.push({ rule, dedupKey });
  }
  return { snapshot, ruleState, baseline, hits, lowestBaseline: previousLowest(input.dlwatcher, input.log, episode?.startedAt) };
}

/**
 * `setTarget`（§6）：用目前的快照重算 `target` 的狀態。已經成立就記成成立（不通知）；
 * 沒有目標價或不成立時回傳 undefined（從 ruleState 刪掉）。
 * 快照是查不到（available: false）時用最後一次知道的價格（快照沿用的價格欄位，v0.16）：查不到時規則狀態維持不變，
 * 這裡清成不成立的話，恢復時會發出 target。
 */
export function targetStateFor(
  snap: PriceSnapshot | undefined,
  targetPrice: number | undefined,
  prev: RuleState | undefined,
  now: string,
): RuleState | undefined {
  if (!snap || targetPrice === undefined || snap.price > targetPrice) return undefined;
  return { active: true, since: prev?.active && prev.since ? prev.since : now };
}
