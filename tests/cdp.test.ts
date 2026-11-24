// tests/e2e/cdp.ts 的防卡住機制：Chrome 不回應時指令要失敗，不能永遠等下去。
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { Cdp } from './e2e/cdp.ts';

function setup() {
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  const sent: { id: number; method: string; sessionId?: string }[] = [];
  toChrome.setEncoding('utf8');
  toChrome.on('data', (chunk: string) => {
    for (const part of chunk.split('\0').filter(Boolean)) sent.push(JSON.parse(part) as (typeof sent)[number]);
  });
  const reply = (msg: unknown) => fromChrome.write(JSON.stringify(msg) + '\0');
  return { cdp: new Cdp(toChrome, fromChrome), sent, reply, fromChrome };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Cdp', () => {
  it('resolves replies', async () => {
    const { cdp, sent, reply } = setup();
    const p = cdp.send('Browser.getVersion');
    await tick();
    reply({ id: sent[0]!.id, result: { product: 'Chrome/1' } });
    await expect(p).resolves.toEqual({ product: 'Chrome/1' });
  });

  it('fails a call with no reply, naming the method', async () => {
    const { cdp } = setup();
    await expect(cdp.send('Runtime.evaluate', {}, 'ABCDEF1234', 20)).rejects.toThrow(
      /Runtime\.evaluate \(session ABCDEF12\): no reply within 20 ms/,
    );
  });

  it('fails pending calls of a session when it detaches', async () => {
    const { cdp, reply } = setup();
    const p = cdp.send('Runtime.enable', {}, 'sw-session');
    const other = cdp.send('Page.enable', {}, 'page-session', 200);
    await tick();
    reply({ method: 'Target.detachedFromTarget', params: { sessionId: 'sw-session' } });
    await expect(p).rejects.toThrow(/Runtime\.enable .*session detached/);
    await expect(other).rejects.toThrow(/no reply within 200 ms/);
  });

  it('fails pending and later calls once the pipe closes', async () => {
    const { cdp, fromChrome } = setup();
    const p = cdp.send('Browser.close');
    fromChrome.destroy();
    await expect(p).rejects.toThrow(/Browser\.close: CDP pipe closed/);
    await expect(cdp.send('Target.getTargets')).rejects.toThrow(/Target\.getTargets: CDP pipe closed/);
  });

  it('fails pending and later calls of a session whose target is destroyed (no detach event)', async () => {
    const { cdp, reply } = setup();
    reply({
      method: 'Target.attachedToTarget',
      params: { sessionId: 'sw-session', targetInfo: { targetId: 'T1', type: 'service_worker' } },
    });
    await tick();
    const p = cdp.send('Runtime.evaluate', {}, 'sw-session');
    await tick();
    reply({ method: 'Target.targetDestroyed', params: { targetId: 'T1' } });
    await expect(p).rejects.toThrow(/Runtime\.evaluate .*target destroyed/);
    await expect(cdp.send('Runtime.enable', {}, 'sw-session')).rejects.toThrow(/Runtime\.enable .*target destroyed/);
  });

  it('fails a waiting session call once its target disappears from Target.getTargets (no event at all)', async () => {
    vi.useFakeTimers();
    try {
      const { cdp, sent, reply } = setup();
      reply({ method: 'Target.attachedToTarget', params: { sessionId: 'sw', targetInfo: { targetId: 'T1' } } });
      await vi.advanceTimersByTimeAsync(0);
      const p = cdp.send('Runtime.evaluate', {}, 'sw');
      p.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(3_000);
      const q = sent.find((m) => m.method === 'Target.getTargets');
      expect(q).toBeDefined();
      reply({ id: q!.id, result: { targetInfos: [{ targetId: 'PAGE' }] } });
      await vi.advanceTimersByTimeAsync(0);
      await expect(p).rejects.toThrow(/Runtime\.evaluate \(session sw\): target no longer exists/);
      await expect(cdp.send('Runtime.enable', {}, 'sw')).rejects.toThrow(/target no longer exists/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps waiting while the target still exists', async () => {
    vi.useFakeTimers();
    try {
      const { cdp, sent, reply } = setup();
      reply({ method: 'Target.attachedToTarget', params: { sessionId: 'pg', targetInfo: { targetId: 'T2' } } });
      await vi.advanceTimersByTimeAsync(0);
      const p = cdp.send('Runtime.evaluate', {}, 'pg');
      await vi.advanceTimersByTimeAsync(3_000);
      const q = sent.find((m) => m.method === 'Target.getTargets')!;
      reply({ id: q.id, result: { targetInfos: [{ targetId: 'T2' }] } });
      await vi.advanceTimersByTimeAsync(0);
      const ev = sent.find((m) => m.method === 'Runtime.evaluate')!;
      reply({ id: ev.id, result: { result: { value: 1 } } });
      await expect(p).resolves.toEqual({ result: { value: 1 } });
    } finally {
      vi.useRealTimers();
    }
  });
});
