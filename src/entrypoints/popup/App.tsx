import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { NavLink } from '../../components/NavLink';
import { WorkImage } from '../../components/WorkImage';
import { WorkLink } from '../../components/WorkLink';
import { isWorkId } from '../../lib/ids';
import type { ExtMessage, WriteReply } from '../../lib/messages';
import {
  NOT_FOUND_SUGGEST_REMOVE,
  type HistoryRecord,
  type PriceLogEntry,
  type PriceSnapshot,
  type Settings,
  type TrackedItem,
} from '../../lib/models';
import { isOnSale } from '../../lib/rules';
import { jstDate, localDate, nowIso } from '../../lib/dates';
import { onDbVersionChange, readAllHistory, readAllPriceLogs } from '../../lib/db';
import { summarizeLowest } from '../../lib/history';
import { readDailyAutoAdd, readItems, readSettings, readSnapshots, readStorageLock, STORAGE_KEYS } from '../../lib/storage';

interface Data {
  items: TrackedItem[];
  snapshots: Map<string, PriceSnapshot>;
  settings: Settings;
  /** DLWatcher 的史低與歷史、自己的查價紀錄（IndexedDB，§5.3）。 */
  histories: Map<string, HistoryRecord>;
  logs: Map<string, PriceLogEntry[]>;
  /** 今天因為上限沒有自動加入的件數（§3.2.4）。 */
  autoAddSkipped: number;
}

/** 這些 key 變動時重新讀取。IndexedDB 沒有變動事件：background 每處理完一件就會寫回 queues，跟著重讀。 */
const WATCHED_KEYS = [
  STORAGE_KEYS.items,
  STORAGE_KEYS.snapshots,
  STORAGE_KEYS.dailyAutoAdd,
  STORAGE_KEYS.settings,
  STORAGE_KEYS.queues,
] as const;

/** 擴充功能頁面直接讀 storage，並用 onChanged 更新（§4.2）。 */
function useTrackedData(): { data: Data | null; dbOutdated: boolean } {
  const [data, setData] = useState<Data | null>(null);
  const [dbOutdated, setDbOutdated] = useState(false);
  useEffect(() => {
    let alive = true;
    // 讀取可能晚到：只採用最新一次的結果（M3 審查：舊的結果不能蓋掉新的）
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      const [items, snapshots, settings, daily, histories, logs] = await Promise.all([
        readItems(),
        readSnapshots(),
        readSettings(),
        readDailyAutoAdd(jstDate(nowIso())),
        readAllHistory().catch(() => new Map<string, HistoryRecord>()),
        readAllPriceLogs().catch(() => new Map<string, PriceLogEntry[]>()),
      ]);
      if (alive && mine === seq)
        setData({
          items: [...items.values()].sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
          snapshots,
          settings,
          histories,
          logs,
          autoAddSkipped: daily.skipped,
        });
    };
    void load();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && WATCHED_KEYS.some((k) => k in changes)) void load();
    };
    browser.storage.onChanged.addListener(onChanged);
    // §4.2：資料庫被新版本升級時關閉連線，提示重新開啟
    const offDb = onDbVersionChange(() => setDbOutdated(true));
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(onChanged);
      offDb();
    };
  }, []);
  return { data, dbOutdated };
}

async function send(msg: ExtMessage): Promise<WriteReply> {
  try {
    const reply = (await browser.runtime.sendMessage(msg)) as WriteReply | undefined;
    return reply ?? { ok: false, reason: 'noReply' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

const REASON_TEXT: Record<string, string> = {
  limit: '追蹤清單已達 1,000 件上限',
  invalidId: '作品編號格式不正確',
  noReply: '背景程式沒有回應，請稍後再試',
  failed: '操作失敗，請稍後再試',
  network: '連不上 DLsite，請稍後再試',
  tooLarge: 'DLsite 回應異常',
  unparsable: 'DLsite 回應異常',
  notObject: 'DLsite 回應異常',
  invalidData: 'DLsite 回傳的資料格式不符',
  cooldown: '10 分鐘內已經重新查價過，請稍後再試',
  queued: '已排入查價佇列，稍後會自動查價',
  backoff: 'DLsite 暫時無法連線，稍後會自動重試',
  notTracked: '這個作品不在追蹤清單裡',
  paused: '這個作品已暫停追蹤',
};
const reasonText = (reason: string) =>
  REASON_TEXT[reason] ?? (/^http\d+$/.test(reason) ? `DLsite 回應錯誤（${reason.slice(4)}）` : REASON_TEXT.failed);

/** setAccessLevel 失敗時顯示警告（§4.2）。 */
function useStorageLockFailed(): boolean {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    readStorageLock().then(
      (s) => setFailed(s?.ok === false),
      () => undefined,
    );
  }, []);
  return failed;
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

/** 史低：DLWatcher 與自己的紀錄兩個數字並列（§3.6）。 */
function LowestCell({ id, data }: { id: string; data: Data }) {
  const s = summarizeLowest(data.histories.get(id), data.logs.get(id) ?? [], data.settings);
  if (!s.dlwatcher && !s.own) return <div className="text-xs text-gray-500">還沒有史低資料</div>;
  return (
    <div className="mt-0.5 space-y-0.5 text-xs text-gray-600" data-testid="lowest">
      {s.dlwatcher && (
        <div data-testid="lowest-dlwatcher">
          史低 <span className="font-bold text-gray-900">{yen(s.dlwatcher.price)}</span>（{localDate(s.dlwatcher.start)}〜
          {localDate(s.dlwatcher.end)}）<span className="text-gray-400">DLWatcher</span>
          {/* §3.6：保留下來的資料要看得出是什麼時候取得的，一律標示 */}
          <span className="ml-1 text-gray-400" data-testid="lowest-fetched">
            資料取得於 {localDate(s.dlwatcher.fetchedAt)}
          </span>
          {s.dlwatcher.divergent && <span className="ml-1 text-amber-700">DLWatcher 資料與自己的紀錄差異很大</span>}
        </div>
      )}
      {s.own && (
        <div data-testid="lowest-own">
          {s.dlwatcher ? '自己的紀錄' : '史低'} <span className="font-bold text-gray-900">{yen(s.own.price)}</span>
          （自 {localDate(s.own.since)} 開始追蹤以來的最低價）
        </div>
      )}
    </div>
  );
}

/** DLWatcher 開關與說明（§3.3），被自動暫停時顯示重新開啟（§3.6）。 */
function DlwatcherSettings({ settings, onError }: { settings: Settings; onError: (reason: string) => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (msg: ExtMessage) => {
    setBusy(true);
    const r = await send(msg);
    setBusy(false);
    if (!r.ok) onError(r.reason);
  };
  return (
    <details className="mt-3 border-t border-gray-200 pt-2" open={settings.dlwatcherAutoPausedAt !== undefined}>
      <summary className="cursor-pointer text-xs text-gray-600">設定</summary>
      {settings.dlwatcherAutoPausedAt && (
        <p role="status" className="mt-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900" data-testid="dlwatcher-paused">
          DLWatcher 似乎已停止服務，已改用自己的紀錄（{localDate(settings.dlwatcherAutoPausedAt)} 自動暫停）。
          <button
            type="button"
            className="ml-1 text-blue-700 underline"
            disabled={busy}
            onClick={() => void run({ type: 'resumeDlwatcher' })}
          >
            重新開啟
          </button>
        </p>
      )}
      <label className="mt-2 flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          data-testid="dlwatcher-enabled"
          checked={settings.dlwatcherEnabled}
          disabled={busy}
          onChange={(e) => void run({ type: 'setSettings', partial: { dlwatcherEnabled: e.target.checked } })}
        />
        <span>
          使用 DLWatcher 的史低與價格走勢
          <span className="block text-gray-500">
            只有你按「查史低」或作品在追蹤清單裡時，才會把作品編號送給 DLWatcher。關閉後只用自己的查價紀錄。
          </span>
        </span>
      </label>
    </details>
  );
}

interface PriceCellProps {
  item: TrackedItem;
  snap: PriceSnapshot | undefined;
  checking: boolean;
  error: string | undefined;
  onRecheck: () => void;
}

function PriceCell({ item, snap, checking, error, onRecheck }: PriceCellProps) {
  const misses = item.notFoundCount ?? 0;
  const removeHint = misses >= NOT_FOUND_SUGGEST_REMOVE && (
    <span className="ml-1 text-xs text-amber-700">連續 {misses} 次查不到，可以考慮移除</span>
  );
  if (checking) return <span className="text-gray-500">查價中…</span>;
  if (!snap) {
    // §5.3：第一次查價就查不到時顯示「查不到這個作品」，不寫快照。
    if (misses > 0) return <span className="text-gray-500">查不到這個作品{removeHint}</span>;
    return (
      <span className="text-gray-500">
        還沒有價格{error && <span className="ml-1 text-red-600">（{error}）</span>}
        <button type="button" className="ml-2 text-xs text-blue-700 hover:underline" onClick={onRecheck}>
          重新查價
        </button>
      </span>
    );
  }
  if (!snap.available)
    return (
      <span className="text-gray-500">
        目前查不到（上次 {yen(snap.price)}）{removeHint}
      </span>
    );
  // §6：「打折中」一律用 isOnSale。
  const onSale = isOnSale(snap, Date.now());
  return (
    <span>
      <span className={onSale ? 'font-bold text-red-600' : 'font-bold'}>{yen(snap.price)}</span>
      {onSale && (
        <span className="ml-1 text-xs text-gray-500">
          <s>{yen(snap.officialPrice)}</s> {snap.discountRate}% OFF
        </span>
      )}
    </span>
  );
}

export function App() {
  const { data, dbOutdated } = useTrackedData();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const [checkErrors, setCheckErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const lockFailed = useStorageLockFailed();

  const add = useCallback(async () => {
    const id = input.trim().toUpperCase();
    if (!isWorkId(id)) {
      setError('請輸入作品編號，例如 RJ01014447');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await send({ type: 'track', id, from: 'manual' });
    setBusy(false);
    if (r.ok) setInput('');
    else setError(reasonText(r.reason) ?? null);
  }, [input]);

  const remove = useCallback(async (id: string) => {
    const r = await send({ type: 'untrack', id });
    if (!r.ok) setError(reasonText(r.reason) ?? null);
  }, []);

  const recheck = useCallback(async (id: string) => {
    setChecking((s) => new Set(s).add(id));
    const r = await send({ type: 'recheck', ids: [id] });
    setChecking((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    setCheckErrors((m) => {
      const next = new Map(m);
      if (r.ok) next.delete(id);
      else next.set(id, reasonText(r.reason) ?? '');
      return next;
    });
  }, []);

  return (
    <main className="w-[380px] p-3 text-sm text-gray-900">
      <h1 className="mb-2 text-base font-bold">DL_Assistant</h1>
      {dbOutdated && (
        <p role="alert" className="mb-2 rounded bg-amber-100 px-2 py-1 text-amber-900">
          擴充功能已更新，請關閉這個視窗再重新開啟。
        </p>
      )}
      {lockFailed && (
        <p role="alert" className="mb-2 rounded bg-amber-100 px-2 py-1 text-amber-900">
          這個 Chrome 版本無法限制網頁程式讀取擴充功能的資料。請更新 Chrome。
        </p>
      )}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-gray-300 px-2 py-1 font-mono"
          placeholder="RJ01014447"
          aria-label="作品編號"
          value={input}
          maxLength={20}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <button
          type="button"
          className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => void add()}
        >
          {busy ? '加入中…' : '加入追蹤'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-red-600">
          {error}
        </p>
      )}
      {data && data.autoAddSkipped > 0 && (
        <p role="status" className="mt-2 rounded bg-amber-100 px-2 py-1 text-amber-900">
          今天有 {data.autoAddSkipped} 件作品沒有自動加入（超過上限），請到
          <NavLink name="cart" className="mx-1 text-blue-700 underline">
            購物車頁
          </NavLink>
          確認。
        </p>
      )}
      <ul className="mt-3 divide-y divide-gray-200" aria-label="追蹤清單">
        {data?.items.map((item) => (
          <li key={item.id} className="flex gap-2 py-2" data-work-id={item.id}>
            <WorkLink site={item.site} id={item.id} className="shrink-0">
              <WorkImage url={item.imageUrl} className="h-[60px] w-20 rounded object-cover" />
            </WorkLink>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <WorkLink site={item.site} id={item.id} className="line-clamp-2 text-blue-700 hover:underline">
                  {item.title || item.id}
                </WorkLink>
                <span className="flex shrink-0 items-center gap-2">
                  {item.autoAdded && (
                    <span className="rounded bg-gray-100 px-1 text-xs text-gray-600" data-testid="auto-added">
                      {item.source === 'page' ? '從作品頁加入' : '自動加入'}
                    </span>
                  )}
                  <button type="button" className="text-xs text-gray-500 hover:text-red-600" onClick={() => void remove(item.id)}>
                    移除
                  </button>
                </span>
              </div>
              <div className="mt-1" data-testid="price">
                <PriceCell
                  item={item}
                  snap={data.snapshots.get(item.id)}
                  checking={checking.has(item.id)}
                  error={checkErrors.get(item.id)}
                  onRecheck={() => void recheck(item.id)}
                />
              </div>
              <LowestCell id={item.id} data={data} />
            </div>
          </li>
        ))}
      </ul>
      {data && data.items.length === 0 && <p className="mt-3 text-gray-500">還沒有追蹤任何作品。</p>}
      {data && <DlwatcherSettings settings={data.settings} onError={(r) => setError(reasonText(r) ?? null)} />}
    </main>
  );
}
