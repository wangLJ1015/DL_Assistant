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
