import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  classifyMessage,
  contentMessageSchema,
  extMessageSchema,
  isBackgroundSender,
  isContentSender,
  isExtPageSender,
  toContentMessageSchema,
  type SenderLike,
} from '../src/lib/messages';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXT_ORIGIN = `chrome-extension://${ID}`;
const BASE = `${EXT_ORIGIN}/`;

const content: SenderLike = {
  id: ID,
  origin: 'https://www.dlsite.com',
  url: 'https://www.dlsite.com/home/work/=/product_id/RJ01014447.html',
  frameId: 0,
  tab: { id: 1 },
  documentId: 'doc',
  documentLifecycle: 'active',
};
const extPage: SenderLike = { id: ID, origin: EXT_ORIGIN, url: `${BASE}popup.html`, tab: undefined };

describe('sender checks (§3.2.4)', () => {
  it('accepts the expected senders', () => {
    expect(isContentSender(content, ID)).toBe(true);
    expect(isContentSender({ ...content, documentLifecycle: undefined }, ID)).toBe(true);
    expect(isExtPageSender(extPage, ID, BASE)).toBe(true);
    // 儀表板開在分頁裡也會帶 tab
    expect(isExtPageSender({ ...extPage, url: `${BASE}dashboard.html`, tab: { id: 2 } }, ID, BASE)).toBe(true);
    expect(isBackgroundSender({ id: ID }, ID)).toBe(true);
  });

  it.each<[string, SenderLike]>([
    ['origin "null"', { ...content, origin: 'null' }],
    ['look-alike origin', { ...content, origin: 'https://www.dlsite.com.evil.example' }],
    ['http origin', { ...content, origin: 'http://www.dlsite.com' }],
    ['subframe', { ...content, frameId: 1 }],
    ['no tab', { ...content, tab: undefined }],
    ['other extension', { ...content, id: 'other' }],
    ['prerendered document', { ...content, documentLifecycle: 'prerender' }],
    ['cached document', { ...content, documentLifecycle: 'cached' }],
  ])('rejects content sender: %s', (_, s) => {
    expect(isContentSender(s, ID)).toBe(false);
    expect(classifyMessage({ type: 'track', id: 'RJ01014447' }, s, ID, BASE).from).toBe('rejected');
  });

  it.each<[string, SenderLike]>([
    ['origin "null"', { ...extPage, origin: 'null' }],
    ['dlsite origin', { ...extPage, origin: 'https://www.dlsite.com' }],
    ['other extension origin', { ...extPage, origin: 'chrome-extension://other' }],
    ['other extension id', { ...extPage, id: 'other' }],
    ['url outside the extension', { ...extPage, url: 'https://www.dlsite.com/' }],
    ['look-alike url', { ...extPage, url: `${EXT_ORIGIN}.evil/popup.html` }],
    ['no url', { ...extPage, url: undefined }],
  ])('rejects extension page sender: %s', (_, s) => {
    expect(isExtPageSender(s, ID, BASE)).toBe(false);
    expect(classifyMessage({ type: 'track', id: 'RJ01014447', from: 'manual' }, s, ID, BASE).from).toBe('rejected');
  });

  it('background → content only accepts messages without a tab', () => {
    expect(isBackgroundSender({ id: ID, tab: { id: 1 } }, ID)).toBe(false);
    expect(isBackgroundSender({ id: 'other' }, ID)).toBe(false);
  });
});

describe('message schemas', () => {
  it('are locked by snapshot (adding a message must update this test and the spec)', () => {
    expect({
      content: z.toJSONSchema(contentMessageSchema, { unrepresentable: 'any' }),
      ext: z.toJSONSchema(extMessageSchema, { unrepresentable: 'any' }),
      toContent: z.toJSONSchema(toContentMessageSchema, { unrepresentable: 'any' }),
    }).toMatchSnapshot();
  });

  it('routes the same type by sender group', () => {
    // content script 的 track 不能指定來源
    expect(classifyMessage({ type: 'track', id: 'RJ01014447', from: 'manual' }, content, ID, BASE).from).toBe('rejected');
    expect(classifyMessage({ type: 'track', id: 'RJ01014447' }, content, ID, BASE)).toEqual({
      from: 'content',
      msg: { type: 'track', id: 'RJ01014447' },
    });
    // 擴充功能頁面專用的訊息從 content script 送來會被拒絕
    expect(classifyMessage({ type: 'setSettings', partial: {} }, content, ID, BASE).from).toBe('rejected');
    expect(classifyMessage({ type: 'syncCouponsNow' }, content, ID, BASE).from).toBe('rejected');
    expect(classifyMessage({ type: 'cartSnapshot', ids: [] }, extPage, ID, BASE).from).toBe('rejected');
  });

  it.each([
    { type: 'track', id: 'RJ1', from: 'manual' },
    { type: 'track', id: 'RJ01014447', from: 'cart' },
    { type: 'track', id: 'RJ01014447', from: 'manual', extra: 1 },
    { type: 'recheck', ids: [] },
    { type: 'recheck', ids: Array.from({ length: 101 }, (_, i) => `RJ${String(i).padStart(6, '0')}`) },
    { type: 'setTarget', id: 'RJ01014447', price: -1 },
    { type: 'setTarget', id: 'RJ01014447', price: '1e3' },
    { type: 'setCouponReserved', key: 'x'.repeat(301), reserved: true },
    { type: 'fetchUrl', url: 'https://www.dlsite.com/home/mypage/coupon' },
    { type: '__proto__' },
    null,
    'track',
  ])('rejects %j from extension pages', (msg) => {
    expect(extMessageSchema.safeParse(msg).success).toBe(false);
  });

  it('setSettings rejects extra and background-only fields', () => {
    const ok = {
      type: 'setSettings',
      partial: { checkIntervalHours: 3, rules: { sale: true, target: false, lowest: true, ending: true, couponExpiring: true } },
    };
    expect(extMessageSchema.safeParse(ok).success).toBe(true);
    for (const partial of [
      { dlwatcherAutoPausedAt: '2026-11-23T00:00:00.000Z' },
      { reservedCouponKeys: [] },
      { unknownField: true },
      { checkIntervalHours: 0 },
      { checkIntervalHours: 25 },
      { checkIntervalHours: 1.5 },
      { rules: { sale: true } },
      { rules: { sale: true, target: true, lowest: true, ending: true, couponExpiring: true, deeper: true } },
      { __proto__: { checkIntervalHours: 1 }, x: 1 },
    ]) {
      expect(extMessageSchema.safeParse({ type: 'setSettings', partial }).success, JSON.stringify(partial)).toBe(false);
    }
  });

  it('cartSnapshot accepts at most 200 ids', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `RJ${String(i).padStart(6, '0')}`);
    expect(contentMessageSchema.safeParse({ type: 'cartSnapshot', ids: ids(200) }).success).toBe(true);
    expect(contentMessageSchema.safeParse({ type: 'cartSnapshot', ids: ids(201) }).success).toBe(false);
  });

  it('openPage only opens the extension pages', () => {
    expect(contentMessageSchema.safeParse({ type: 'openPage', page: 'dashboard' }).success).toBe(true);
    expect(contentMessageSchema.safeParse({ type: 'openPage', page: 'planner' }).success).toBe(false);
    expect(contentMessageSchema.safeParse({ type: 'openPage', page: 'https://www.dlsite.com/' }).success).toBe(false);
  });
});
