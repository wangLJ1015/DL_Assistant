// 通知規則與「打折中」的判斷（§6）。M1 先放 isOnSale，規則引擎（§6.1）在 M4。
import { isoToMs } from './dates';
import type { PriceSnapshot } from './models';

/**
 * §6：儀表板、試算、popup 說的「打折中」一律用這個函式。
 * onSale = available && isDiscount && !discountEndStale && !(discountEnd && discountEnd ≤ now)
 */
export function isOnSale(s: PriceSnapshot, nowMs: number): boolean {
  if (!s.available || !s.isDiscount || s.discountEndStale) return false;
  if (s.discountEnd !== undefined && isoToMs(s.discountEnd) <= nowMs) return false;
  return true;
}
