// §6.2 通知內容與點擊（background 專用）。文字的組成是純函式，單元測試直接呼叫。
import { browser } from 'wxt/browser';
import { localMonthDayTime } from './dates';
import { buildWorkUrl } from './ids';
import type { NoticeKind, PriceSnapshot, RecentNotification, WorkRule } from './models';
import { extPageUrl, openTab } from './nav';
import { readItems, readRecentNotifications } from './storage';

export const NOTICE_LABELS: Record<NoticeKind, string> = {
  sale: '特價',
  target: '低於目標價',
  lowest: '史低',
  ending: '即將截止',
  couponExpiring: '優惠券即將到期',
  dlwatcherPaused: 'DLWatcher 已暫停',
};

/** 多件合併時的摘要（「3 個追蹤作品正在特價」）：每件都符合的規則，依這個順序選。 */
const SUMMARY_PHRASES: [WorkRule, string][] = [
  ['sale', '正在特價'],
  ['lowest', '來到史低'],
  ['target', '低於目標價'],
  ['ending', '的特價即將截止'],
];

/** 標題列出規則的順序。 */
const WORK_RULE_ORDER: WorkRule[] = ['sale', 'lowest', 'target', 'ending'];

const TITLE_MAX_CHARS = 60;
const LISTED_WORKS = 3;

/**
 * §6.2：作品名稱、券名放進通知前的清理。控制字元與 U+2028／U+2029 換成空白，刪掉格式字元（U+202E、零寬字元），
 * 合併連續空白，再以字元（不是 UTF-16 單位）截斷到 60 個字。
 */
export function sanitizeForNotification(s: string): string {
  const cleaned = s
    .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, TITLE_MAX_CHARS).join('');
}

export function formatYen(n: number): string {
  return `¥${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export interface NoticeWork {
  id: string;
  title: string;
  snapshot: PriceSnapshot;
  rules: WorkRule[];
  /** 史低基準（§6.1 第 4 步）；沒有時不顯示「和史低差多少」。 */
  lowestBaseline: number | undefined;
}

export interface NoticeContent {
  title: string;
  message: string;
  rules: NoticeKind[];
}

function lowestLine(price: number, baseline: number | undefined): string | undefined {
  if (baseline === undefined) return undefined;
  if (price < baseline) return `比史低再低 ${formatYen(baseline - price)}`;
  if (price === baseline) return '和史低同價';
  return `比史低高 ${formatYen(price - baseline)}`;
}

function priceLine(s: PriceSnapshot): string {
  if (s.price < s.officialPrice) {
    const rate = s.discountRate > 0 ? `，${s.discountRate}% OFF` : '';
    return `${formatYen(s.price)}（原價 ${formatYen(s.officialPrice)}${rate}）`;
  }
  return formatYen(s.price);
}

/**
 * §6.2：一批的候選合併成一則通知。標題固定是「DL_Assistant：」加規則名稱（作品名稱不放標題，避免冒充系統通知）。
 * 單一作品：作品名稱、現價／原價、折扣、和史低差多少、截止時間。多件：「N 個追蹤作品正在特價」加前幾件的名稱與價格。
 * `hideTitles`（設定「通知不顯示作品名稱」）：只顯示「N 個追蹤作品…」。
 */
export function buildWorkNotice(works: readonly NoticeWork[], hideTitles: boolean): NoticeContent {
  const rules = WORK_RULE_ORDER.filter((r) => works.some((w) => w.rules.includes(r)));
  const title = `DL_Assistant：${rules.map((r) => NOTICE_LABELS[r]).join('、')}`;
  const phrase = SUMMARY_PHRASES.find(([r]) => works.every((w) => w.rules.includes(r)))?.[1] ?? '有新的優惠';
  const summary = `${works.length} 個追蹤作品${phrase}`;
  if (hideTitles) return { title, message: summary, rules };
  if (works.length === 1) {
    const w = works[0]!;
    const s = w.snapshot;
    const lines = [sanitizeForNotification(w.title) || w.id, priceLine(s)];
    const low = lowestLine(s.price, w.lowestBaseline);
    if (low) lines.push(low);
    if (s.discountEnd && s.isDiscount) lines.push(`截止 ${localMonthDayTime(s.discountEnd)}`);
    return { title, message: lines.join('\n'), rules };
  }
  const lines = [summary];
  for (const w of works.slice(0, LISTED_WORKS)) {
    lines.push(`・${sanitizeForNotification(w.title) || w.id} ${formatYen(w.snapshot.price)}`);
  }
  if (works.length > LISTED_WORKS) lines.push(`…還有 ${works.length - LISTED_WORKS} 件`);
  return { title, message: lines.join('\n'), rules };
}

export const DLWATCHER_PAUSED_NOTICE: NoticeContent = {
  title: `DL_Assistant：${NOTICE_LABELS.dlwatcherPaused}`,
  message: 'DLWatcher 似乎已停止服務，已改用自己的紀錄。要重新開啟，請到擴充功能的 popup 按「重新開啟」。',
  rules: ['dlwatcherPaused'],
};

export function newNotificationId(): string {
  return crypto.randomUUID();
}

/** RecentNotification（§5.3）。text 是通知內文。 */
export function toRecent(
  notificationId: string,
  content: NoticeContent,
  ids: readonly string[],
  at: string,
  couponKeys?: readonly string[],
): RecentNotification {
  const r: RecentNotification = { notificationId, ids: [...ids], rules: [...content.rules], text: content.message.slice(0, 2000), at };
  if (couponKeys && couponKeys.length > 0) r.couponKeys = [...couponKeys];
  return r;
}

/**
 * 送出系統通知（§4.2：storage 與 IndexedDB 都寫完之後才呼叫）。圖示一律用擴充功能內建的（§6.2）。
 * 失敗（例如通知被關閉）只記錄，不影響查價；「最近的通知」照樣看得到。
 */
export async function showNotification(notificationId: string, content: NoticeContent): Promise<void> {
  try {
    await browser.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: content.title,
      message: content.message,
      priority: 0,
    });
  } catch (e) {
    console.warn('[DL_Assistant] 系統通知送出失敗（最近的通知仍看得到）', e);
  }
}

/**
 * §6.2 點擊通知：單一作品開作品頁（buildWorkUrl）；多件合併開 `dashboard.html?n=<notificationId>`；
 * couponExpiring 開試算頁。DLWatcher 暫停等沒有對象的通知只關掉。網址都由這裡自己組，不用通知裡的任何文字。
 */
export async function handleNotificationClick(notificationId: string): Promise<void> {
  const recent = (await readRecentNotifications()).find((r) => r.notificationId === notificationId);
  await browser.notifications.clear(notificationId).catch(() => undefined);
  if (!recent) return;
  if (recent.couponKeys && recent.couponKeys.length > 0) {
    await openTab(extPageUrl('planner'));
  } else if (recent.ids.length === 1) {
    const id = recent.ids[0]!;
    const item = (await readItems()).get(id);
    await openTab(buildWorkUrl(item?.site, id));
  } else if (recent.ids.length > 1) {
    await openTab(extPageUrl('dashboard', { n: recent.notificationId }));
  }
}
