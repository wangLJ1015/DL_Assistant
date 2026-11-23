// §5.5 日期解析。整個專案只有這個檔案可以用單一參數的 new Date(x) 與 Date.parse（ESLint 強制）。

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JST_OFFSET = 9 * HOUR;

const JST_FULL_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const MMDD_RE = /^(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/;
const CANONICAL_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoToMs(iso: string): number {
  return new Date(iso).getTime();
}

export function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** 符合 toISOString() 格式，而且轉回 ISO 字串和原字串相同。 */
export function isCanonicalIso(s: unknown): s is string {
  if (typeof s !== 'string' || !CANONICAL_ISO_RE.test(s)) return false;
  const ms = Date.parse(s);
  return Number.isFinite(ms) && new Date(ms).toISOString() === s;
}

/** JST 的年月日時分秒轉成 UTC 毫秒；日期不存在或超出範圍時回傳 null（不讓 Date 自動進位）。 */
function jstPartsToMs(y: number, mo: number, d: number, h: number, mi: number, s: number): number | null {
  if (h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s) - JST_OFFSET;
  const back = new Date(ms + JST_OFFSET);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d ||
    back.getUTCHours() !== h ||
    back.getUTCMinutes() !== mi ||
    back.getUTCSeconds() !== s
  ) {
    return null;
  }
  return ms;
}

/** `YYYY-MM-DD HH:mm:ss`（JST）→ UTC ISO 字串；格式不符或日期不存在時回傳 null。 */
export function parseJst(s: string): string | null {
  const m = JST_FULL_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, sec] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const ms = jstPartsToMs(y, mo, d, h, mi, sec);
  return ms === null ? null : msToIso(ms);
}

/** 某個 UTC 時間在 JST 的年份。 */
export function jstYear(iso: string): number {
  return new Date(isoToMs(iso) + JST_OFFSET).getUTCFullYear();
}

/** 某個 UTC 時間在 JST 的日期（YYYY-MM-DD）。 */
export function jstDate(iso: string): string {
  return new Date(isoToMs(iso) + JST_OFFSET).toISOString().slice(0, 10);
}

export type DiscountEnd = { kind: 'known'; iso: string } | { kind: 'unknown'; stale: boolean };

/**
 * `discount_end_date`（`MM/DD HH:mm`，沒有年份，JST）補上年份（§5.5）。
 * - 以 checkedAt 的 JST 年份 y 建立 y−1、y、y+1 三個候選，取最接近 checkedAt 的一個。
 * - 早於 checkedAt 7 天以內：照存（已結束，isOnSale 會是 false）。
 * - 早於 7 天以上：不明，stale = true；晚於 checkedAt + 180 天或沒有候選：不明。
 * - 含年份的完整格式直接用 parseJst。
 */
export function resolveDiscountEnd(raw: string, checkedAt: string): DiscountEnd {
  const full = parseJst(raw);
  if (full !== null) return { kind: 'known', iso: full };
  const m = MMDD_RE.exec(raw);
  if (!m) return { kind: 'unknown', stale: false };
  const [mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number];
  const checkedMs = isoToMs(checkedAt);
  const y = jstYear(checkedAt);
  let best: number | null = null;
  for (const cy of [y - 1, y, y + 1]) {
    const ms = jstPartsToMs(cy, mo, d, h, mi, 0);
    if (ms === null) continue;
    if (best === null || Math.abs(ms - checkedMs) < Math.abs(best - checkedMs)) best = ms;
  }
  if (best === null) return { kind: 'unknown', stale: false };
  if (best < checkedMs - 7 * DAY) return { kind: 'unknown', stale: true };
  if (best > checkedMs + 180 * DAY) return { kind: 'unknown', stale: false };
  return { kind: 'known', iso: msToIso(best) };
}

/** 優惠券 `limit_date`（Unix 秒，2000～2100 年）→ ISO。範圍由 schema 檢查。 */
export function unixSecondsToIso(sec: number): string {
  return msToIso(sec * 1000);
}

/** DLWatcher 的日期格式在 M3 確認（§5.2）；確認前一律當作解析失敗。 */
export function parseDlwatcherDate(_s: string): string | null {
  return null;
}
