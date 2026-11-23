import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { defaultSettings } from '../src/lib/models';
import { createWriteQueue, parseSettings, readItems, readSettings, readSnapshots, writeStore } from '../src/lib/storage';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('Settings', () => {
  it('defaults when missing or broken', async () => {
    expect(await readSettings()).toEqual(defaultSettings());
    for (const raw of [null, 'x', [], 1]) expect(parseSettings(raw)).toEqual(defaultSettings());
  });

  it('fills missing fields and keeps valid ones', () => {
    expect(parseSettings({ checkIntervalHours: 3 })).toEqual({ ...defaultSettings(), checkIntervalHours: 3 });
  });

  it('drops unknown fields and falls back on invalid values', () => {
    expect(parseSettings({ checkIntervalHours: 3, evil: true })).toEqual({ ...defaultSettings(), checkIntervalHours: 3 });
    expect(parseSettings({ checkIntervalHours: 0 })).toEqual(defaultSettings());
  });

  it('defaults match §5.3', () => {
    expect(defaultSettings()).toEqual({
      checkIntervalHours: 6,
      dlwatcherEnabled: true,
      usePointPaymentMethod: false,
      treatUnknownDiscountedAsUsable: false,
      hideTitlesInNotifications: false,
      showBadge: true,
      rules: { sale: true, target: true, lowest: true, ending: true, couponExpiring: true },
      reservedCouponKeys: [],
    });
  });
});

describe('items / snapshots', () => {
  const item = {
    id: 'RJ01014447',
    site: 'home',
    title: 't',
    imageUrl: '',
    addedAt: '2026-11-23T00:00:00.000Z',
    source: 'manual' as const,
    autoAdded: false,
    paused: false,
  };

  it('round-trips through storage as arrays', async () => {
    await writeStore({ items: new Map([[item.id, item]]) });
    expect((await fakeBrowser.storage.local.get('items')).items).toEqual([item]);
    expect([...(await readItems()).values()]).toEqual([item]);
  });

  it('validates every record read back and drops the bad ones', async () => {
    await fakeBrowser.storage.local.set({
      items: [
        item,
        { ...item, id: '__proto__' },
        { ...item, id: 'RJ123456', source: 'evil' },
        { ...item, id: 'RJ123457', extra: 1 },
        null,
        'x',
      ],
      snapshots: { RJ01014447: {} },
    });
    expect([...(await readItems()).keys()]).toEqual(['RJ01014447']);
    expect((await readSnapshots()).size).toBe(0);
  });
});

describe('write queue', () => {
  it('runs read-modify-write jobs in order without lost updates', async () => {
    const enqueue = createWriteQueue();
    let value = 0;
    const jobs = Array.from({ length: 20 }, () =>
      enqueue(async () => {
        const v = value;
        await new Promise((r) => setTimeout(r, Math.random() * 3));
        value = v + 1;
      }),
    );
    await Promise.all(jobs);
    expect(value).toBe(20);
  });

  it('keeps going after a failed job', async () => {
    const enqueue = createWriteQueue();
    await expect(enqueue(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(enqueue(async () => 1)).resolves.toBe(1);
  });
});
