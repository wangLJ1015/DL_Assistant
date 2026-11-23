// §3.2.3 共用的 zod 工具。禁止 z.coerce（ESLint 強制）。
import { z } from 'zod';

/** 整數（數字或最多 9 碼的純數字字串），並限制範圍。 */
export const intIn = (min: number, max: number) =>
  z.union([z.number().int(), z.string().max(9).regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(min).max(max));

/** 可選的字串：空字串、只有空白、null、不存在 → undefined。 */
export const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((s) => {
      const t = s?.trim();
      return t ? t : undefined;
    });

/** 依字元（code point）截斷，不切斷補充平面字元。 */
export function truncateChars(s: string, n: number): string {
  const arr = Array.from(s);
  return arr.length <= n ? s : arr.slice(0, n).join('');
}

/** zod 錯誤只留 path 與 code（§3.3：不把原始值帶進錯誤）。 */
export function summarizeIssues(error: z.ZodError): { path: string; code: string }[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code }));
}

/** §5.5 優惠券 `limit_date`：Unix 秒，限 2000～2100 年（毫秒會超出範圍而被拒絕）。 */
export const unixSecondsSchema = z.number().int().min(946684800).max(4102444800);
