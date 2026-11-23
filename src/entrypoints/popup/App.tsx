import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { WorkLink } from '../../components/WorkLink';
import { isWorkId } from '../../lib/ids';
import type { ExtMessage, WriteReply } from '../../lib/messages';
import type { PriceSnapshot, TrackedItem } from '../../lib/models';
import { readItems, readSnapshots, STORAGE_KEYS } from '../../lib/storage';

interface Data {
  items: TrackedItem[];
  snapshots: Map<string, PriceSnapshot>;
}

/** 擴充功能頁面直接讀 storage，並用 onChanged 更新（§4.2）。 */
function useTrackedData(): Data | null {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [items, snapshots] = await Promise.all([readItems(), readSnapshots()]);
      if (alive) setData({ items: [...items.values()].sort((a, b) => b.addedAt.localeCompare(a.addedAt)), snapshots });
    };
    void load();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && (STORAGE_KEYS.items in changes || STORAGE_KEYS.snapshots in changes)) void load();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);
  return data;
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
};

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

function PriceCell({ snap }: { snap: PriceSnapshot | undefined }) {
  if (!snap) return <span className="text-gray-500">查價中…</span>;
  if (!snap.available) return <span className="text-gray-500">目前查不到（上次 {yen(snap.price)}）</span>;
  return (
    <span>
      <span className={snap.isDiscount ? 'font-bold text-red-600' : 'font-bold'}>{yen(snap.price)}</span>
      {snap.isDiscount && (
        <span className="ml-1 text-xs text-gray-500">
          <s>{yen(snap.officialPrice)}</s> {snap.discountRate}% OFF
        </span>
      )}
    </span>
  );
}

export function App() {
  const data = useTrackedData();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    else setError(REASON_TEXT[r.reason] ?? REASON_TEXT.failed ?? null);
  }, [input]);

  const remove = useCallback(async (id: string) => {
    const r = await send({ type: 'untrack', id });
    if (!r.ok) setError(REASON_TEXT[r.reason] ?? REASON_TEXT.failed ?? null);
  }, []);

  return (
    <main className="p-3 text-sm text-gray-900">
      <h1 className="mb-2 text-base font-bold">DL_Assistant</h1>
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
          加入追蹤
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-red-600">
          {error}
        </p>
      )}
      <ul className="mt-3 divide-y divide-gray-200" aria-label="追蹤清單">
        {data?.items.map((item) => (
          <li key={item.id} className="py-2" data-work-id={item.id}>
            <div className="flex items-start justify-between gap-2">
              <WorkLink site={item.site} id={item.id} className="line-clamp-2 text-blue-700 hover:underline">
                {item.title || item.id}
              </WorkLink>
              <button type="button" className="shrink-0 text-xs text-gray-500 hover:text-red-600" onClick={() => void remove(item.id)}>
                移除
              </button>
            </div>
            <div className="mt-1" data-testid="price">
              <PriceCell snap={data.snapshots.get(item.id)} />
            </div>
          </li>
        ))}
      </ul>
      {data && data.items.length === 0 && <p className="mt-3 text-gray-500">還沒有追蹤任何作品。</p>}
    </main>
  );
}
