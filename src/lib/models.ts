// §5.3 本機資料模型。storage 讀回的資料一律再跑這些 schema（§4.2）。
import { z } from 'zod';
import { isWorkId } from './ids';
import { isCanonicalIso } from './dates';

export const workIdSchema = z.string().refine(isWorkId, { message: 'invalid work id' });
export const isoSchema = z.string().refine(isCanonicalIso, { message: 'invalid iso date' });
const price = z.number().int().min(0).max(1_000_000);

export const rulesSchema = z
  .object({
    sale: z.boolean(),
    target: z.boolean(),
    lowest: z.boolean(),
    ending: z.boolean(),
    couponExpiring: z.boolean(),
  })
  .strict();

export const settingsSchema = z
  .object({
    checkIntervalHours: z.number().int().min(1).max(24),
    dlwatcherEnabled: z.boolean(),
    dlwatcherAutoPausedAt: isoSchema.optional(),
    usePointPaymentMethod: z.boolean(),
    treatUnknownDiscountedAsUsable: z.boolean(),
    hideTitlesInNotifications: z.boolean(),
    showBadge: z.boolean(),
    rules: rulesSchema,
    reservedCouponKeys: z.array(z.string().max(300)).max(1000),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;

export function defaultSettings(): Settings {
  return {
    checkIntervalHours: 6,
    dlwatcherEnabled: true,
    usePointPaymentMethod: false,
    treatUnknownDiscountedAsUsable: false,
    hideTitlesInNotifications: false,
    showBadge: true,
    rules: { sale: true, target: true, lowest: true, ending: true, couponExpiring: true },
    reservedCouponKeys: [],
  };
}

/** 連續查不到的次數上限（只是防止無限增加；達到 3 次就提示移除，§5.3）。 */
export const MAX_NOT_FOUND_COUNT = 999;
export const NOT_FOUND_SUGGEST_REMOVE = 3;

export const trackedItemSchema = z
  .object({
    id: workIdSchema,
    site: z.string().max(30),
    title: z.string().max(300),
    imageUrl: z.string().max(2000),
    addedAt: isoSchema,
    source: z.enum(['cart', 'page', 'manual', 'lookup']),
    autoAdded: z.boolean(),
    baselineAt: isoSchema.optional(),
    targetPrice: price.optional(),
    paused: z.boolean(),
    notFoundCount: z.number().int().min(1).max(MAX_NOT_FOUND_COUNT).optional(),
  })
  .strict();
export type TrackedItem = z.infer<typeof trackedItemSchema>;

export const couponFactsSchema = z
  .object({
    siteId: z.string().max(30),
    workType: z.string().max(20),
    customGenres: z.array(z.string().max(100)).max(200),
    noReduction: z.boolean(),
  })
  .strict();
export type CouponFacts = z.infer<typeof couponFactsSchema>;

export const priceSnapshotSchema = z
  .object({
    id: workIdSchema,
    available: z.boolean(),
    price,
    officialPrice: price,
    isDiscount: z.boolean(),
    discountRate: z.number().int().min(0).max(100),
    discountEnd: isoSchema.optional(),
    discountEndStale: z.literal(true).optional(),
    campaignId: z.string().min(1).max(100).optional(),
    episode: z
      .object({ key: z.string().min(1).max(200), startedAt: isoSchema })
      .strict()
      .optional(),
    pointRate: z.number().int().min(0).max(100),
    couponFacts: couponFactsSchema,
    checkedAt: isoSchema,
  })
  .strict();
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;

/** 追蹤清單總數上限（§3.2.4）。 */
export const MAX_TRACKED_ITEMS = 1000;

// ---- 自動加入（§3.2.4）----

/** content script 的 cartClicked、cartSnapshot、track 合計每天最多自動新增的件數。 */
export const DAILY_AUTO_ADD_LIMIT = 200;
/** 一次 cartSnapshot 最多新增的件數。 */
export const CART_SNAPSHOT_MAX_NEW = 50;

/** `dailyAutoAdd`：JST 日期、今天自動新增的件數、因為上限沒有加入的件數（popup 提示用）。 */
export const dailyAutoAddSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    count: z.number().int().min(0).max(100_000),
    skipped: z.number().int().min(0).max(100_000),
  })
  .strict();
export type DailyAutoAdd = z.infer<typeof dailyAutoAddSchema>;

/** `lastCart`：最近一次 cartSnapshot 讀到的作品（F15「從購物車選擇」）。 */
export const lastCartSchema = z.object({ ids: z.array(workIdSchema).max(200), at: isoSchema }).strict();
export type LastCart = z.infer<typeof lastCartSchema>;
