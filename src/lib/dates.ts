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

/** 畫面顯示用：使用者時區的日期（YYYY-MM-DD，§5.5）。 */
export function localDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 通知用：使用者時區的「M/D HH:mm」（§6.2 截止時間）。 */
export function localMonthDayTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

/**
 * DLWatcher 的日期（§5.2）。2026-11-23 實測：`lowestPrice.start／end`、`recentSalePriceLog[].start／end`
 * 都是 `toISOString()` 格式的 UTC 字串（`2024-07-11T13:40:03.000Z`）。只接受這個格式，其他一律當作解析失敗。
 */
export function parseDlwatcherDate(s: string): string | null {
  return isCanonicalIso(s) ? s : null;
}

/**
 * DLWatcher 走勢點的 x（年內進度 0～1）換算成日期（§5.2）：該年 JST 1/1 00:00 + x × 該年天數。
 * 誤差大約一天。x 的範圍由合理性檢查負責（§3.6）。
 */
export function curvePointDate(year: number, x: number): string {
  const start = Date.UTC(year, 0, 1) - JST_OFFSET;
  const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY;
  return msToIso(Math.round(start + x * days * DAY));
}

/** 測試用：regex 本身（§3.2.6 ReDoS 測試直接對 regex 餵長字串）。 */
export const __regexForTest = { JST_FULL_RE, MMDD_RE, CANONICAL_ISO_RE };
