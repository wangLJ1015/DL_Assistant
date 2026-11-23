// Chrome DevTools Protocol（--remote-debugging-pipe）的最小實作，給 tests/e2e/ 的驗證腳本用。
import type { Readable, Writable } from 'node:stream';

export type Json = Record<string, unknown>;
export interface CdpEvent {
  method: string;
  params: Json;
  sessionId?: string;
}

// ---------------- CDP over pipe ----------------

export class Cdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void; method: string }>();
  private listeners: ((e: CdpEvent) => void)[] = [];
  private buf = '';
  private input: Writable;

  constructor(input: Writable, output: Readable) {
    this.input = input;
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf('\0')) >= 0) {
        const msg = JSON.parse(this.buf.slice(0, i)) as Json;
        this.buf = this.buf.slice(i + 1);
        this.dispatch(msg);
      }
    });
  }

  private dispatch(msg: Json) {
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`));
      else p.resolve((msg.result ?? {}) as Json);
    } else if (typeof msg.method === 'string') {
      const e: CdpEvent = { method: msg.method, params: (msg.params ?? {}) as Json, sessionId: msg.sessionId as string | undefined };
      for (const l of [...this.listeners]) l(e);
    }
  }

  send(method: string, params: Json = {}, sessionId?: string): Promise<Json> {
    const id = this.nextId++;
    const msg: Json = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.input.write(JSON.stringify(msg) + '\0');
    });
  }

  on(fn: (e: CdpEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  waitFor(pred: (e: CdpEvent) => boolean, timeoutMs = 15_000, what = 'event'): Promise<CdpEvent> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        off();
        reject(new Error(`timeout waiting for ${what}`));
      }, timeoutMs);
      const off = this.on((e) => {
        if (pred(e)) {
          clearTimeout(t);
          off();
          resolve(e);
        }
      });
    });
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function evaluate(cdp: Cdp, sessionId: string, expression: string, contextId?: number): Promise<unknown> {
  const params: Json = { expression, awaitPromise: true, returnByValue: true };
  if (contextId !== undefined) params.contextId = contextId;
  const r = await cdp.send('Runtime.evaluate', params, sessionId);
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
  return (r.result as { value?: unknown }).value;
}

export async function poll<T>(fn: () => Promise<T | undefined>, timeoutMs: number, what: string): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error(`timeout: ${what}`);
    await sleep(200);
  }
}
