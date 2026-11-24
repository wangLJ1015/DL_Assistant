// Chrome DevTools Protocol（--remote-debugging-pipe）的最小實作，給 tests/e2e/ 的驗證腳本用。
//
// 防止卡住（2026-11-24）：verify-m1／m2 偶爾整支腳本沒有輸出、一直不結束。CDP 指令只要 Chrome 不回應就會永遠等下去，
// 所以這裡每個指令都有逾時（失敗時訊息帶指令名稱）；target 消失、session 被分離、Chrome 結束或 pipe 關閉時，
// 還在等的指令立刻失敗，之後送到那個 session 的指令也直接失敗。
// 實測（Chrome 158，docs/verification.md §10.3「CDP 附加 service worker」）：附加中的 service worker 被停止時，
// target 從 Target.getTargets 消失，但沒有 Target.targetDestroyed，也沒有 Target.detachedFromTarget；送到那個 session
// 的指令（已送出的和之後送的）都不會有任何回應。所以指令等超過 LIVENESS_MS 時，用 Target.getTargets 確認 target 還在。
import { spawnSync, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export type Json = Record<string, unknown>;
export interface CdpEvent {
  method: string;
  params: Json;
  sessionId?: string;
}

/** 單一 CDP 指令的預設逾時。`CDP_TIMEOUT_MS` 可以覆寫（除錯時放長）。 */
export const DEFAULT_TIMEOUT_MS = Number(process.env.CDP_TIMEOUT_MS) || 60_000;
/** 送到 session 的指令等超過這麼久，就檢查它的 target 還在不在。 */
const LIVENESS_MS = 3_000;

interface Pending {
  resolve: (v: Json) => void;
  reject: (e: Error) => void;
  method: string;
  sessionId?: string;
  sentAt: number;
  timer: NodeJS.Timeout;
}

// ---------------- CDP over pipe ----------------

export class Cdp {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners: ((e: CdpEvent) => void)[] = [];
  private buf = '';
  private input: Writable;
  /** pipe 關閉或 Chrome 結束後設定；之後的指令一律直接失敗。 */
  private closedReason: string | undefined;
  /** 附加中的 session → targetId（從 Target.attachedToTarget 得知）。 */
  private sessionTargets = new Map<string, string>();
  /** target 已經消失的 session → 原因。Chrome 不會回應送到這些 session 的指令。 */
  private deadSessions = new Map<string, string>();
  private liveness: NodeJS.Timeout | undefined;
  private checking = false;

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
    output.on('close', () => this.close('CDP pipe closed (Chrome exited?)'));
    output.on('error', (e) => this.close(`CDP pipe error: ${e.message}`));
    input.on('error', (e) => this.close(`CDP pipe error: ${e.message}`));
  }

  /** 讓所有還在等的指令失敗；之後的指令也直接失敗。 */
  close(reason: string) {
    if (this.closedReason) return;
    this.closedReason = reason;
    clearInterval(this.liveness);
    for (const [id, p] of this.pending) this.fail(id, p, reason);
  }

  private fail(id: number, p: Pending, reason: string) {
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.reject(new Error(`${p.method}${p.sessionId ? ` (session ${p.sessionId.slice(0, 8)})` : ''}: ${reason}`));
  }

  private killSession(sessionId: string, reason: string) {
    this.sessionTargets.delete(sessionId);
    this.deadSessions.set(sessionId, reason);
    for (const [id, p] of this.pending) if (p.sessionId === sessionId) this.fail(id, p, `${reason} before reply`);
  }

  private dispatch(msg: Json) {
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`));
      else p.resolve((msg.result ?? {}) as Json);
    } else if (typeof msg.method === 'string') {
      const e: CdpEvent = { method: msg.method, params: (msg.params ?? {}) as Json, sessionId: msg.sessionId as string | undefined };
      if (e.method === 'Target.attachedToTarget') {
        const info = e.params.targetInfo as { targetId?: string } | undefined;
        if (typeof e.params.sessionId === 'string' && info?.targetId) this.sessionTargets.set(e.params.sessionId, info.targetId);
      } else if (e.method === 'Target.detachedFromTarget') {
        if (typeof e.params.sessionId === 'string') this.killSession(e.params.sessionId, 'session detached');
      } else if (e.method === 'Target.targetDestroyed') {
        // 要開著 Target.setDiscoverTargets 才收得到；附加中的 service worker 被停止時沒有這個事件（見檔頭）
        for (const [sessionId, targetId] of this.sessionTargets)
          if (targetId === e.params.targetId) this.killSession(sessionId, 'target destroyed (service worker stopped or replaced?)');
      }
      for (const l of [...this.listeners]) l(e);
    }
  }

  send(method: string, params: Json = {}, sessionId?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Json> {
    if (this.closedReason) return Promise.reject(new Error(`${method}: ${this.closedReason}`));
    const dead = sessionId && this.deadSessions.get(sessionId);
    if (dead) return Promise.reject(new Error(`${method} (session ${sessionId.slice(0, 8)}): ${dead}`));
    const id = this.nextId++;
    const msg: Json = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.pending.get(id);
        if (p) this.fail(id, p, `no reply within ${timeoutMs} ms`);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, sessionId, sentAt: Date.now(), timer });
      this.input.write(JSON.stringify(msg) + '\0');
      if (sessionId && !this.liveness) {
        this.liveness = setInterval(() => void this.checkLiveness(), LIVENESS_MS);
        this.liveness.unref();
      }
    });
  }

  /** 等太久的 session 指令：target 已經不在 Target.getTargets 裡就讓它失敗（見檔頭）。 */
  private async checkLiveness() {
    const waiting = [...this.pending.values()].filter((p) => p.sessionId && Date.now() - p.sentAt >= LIVENESS_MS);
    if (waiting.length === 0) {
      if (![...this.pending.values()].some((p) => p.sessionId)) {
        clearInterval(this.liveness);
        this.liveness = undefined;
      }
      return;
    }
    if (this.checking) return;
    this.checking = true;
    try {
      const { targetInfos } = (await this.send('Target.getTargets', {}, undefined, 5_000)) as { targetInfos: { targetId: string }[] };
      const alive = new Set(targetInfos.map((t) => t.targetId));
      for (const p of waiting) {
        const targetId = this.sessionTargets.get(p.sessionId!);
        if (targetId && !alive.has(targetId)) this.killSession(p.sessionId!, 'target no longer exists (service worker stopped?)');
      }
    } catch {
      // getTargets 本身失敗：交給各指令自己的逾時
    } finally {
      this.checking = false;
    }
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

export async function evaluate(
  cdp: Cdp,
  sessionId: string,
  expression: string,
  contextId?: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const params: Json = { expression, awaitPromise: true, returnByValue: true };
  if (contextId !== undefined) params.contextId = contextId;
  let r: Json;
  try {
    r = await cdp.send('Runtime.evaluate', params, sessionId, timeoutMs);
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : String(e)} — expression: ${expression.slice(0, 120)}`);
  }
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

// ---------------- service worker ----------------

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

/** 擴充功能 service worker 目前的 target（找不到就等，最多 timeoutMs）。 */
export function findServiceWorker(cdp: Cdp, ext: string, timeoutMs = 15_000): Promise<string> {
  return poll(
    async () => {
      const { targetInfos } = (await cdp.send('Target.getTargets', {}, undefined, 5_000)) as { targetInfos: TargetInfo[] };
      return targetInfos.find((t) => t.type === 'service_worker' && t.url === `${ext}/background.js`)?.targetId;
    },
    timeoutMs,
    'service worker target',
  );
}

/**
 * 附加到擴充功能的 service worker，等到 `chrome.storage.local` 可以用才回傳 session。
 *
 * 剛 `Extensions.loadUnpacked` 之後（或 service worker 重新啟動時），找到的 target 可能還在啟動或正被替換：
 * 附加上去之後 `chrome` 還沒定義，或指令一直不回應。這裡逐次重試：附加 → `onAttach`（例如 `Fetch.enable`，
 * 要在 service worker 發出請求前攔截）→ 檢查 `chrome` → 不行就分離再試。
 */
export async function attachServiceWorker(
  cdp: Cdp,
  ext: string,
  opts: { onAttach?: (sessionId: string) => Promise<unknown>; timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const failures: string[] = [];
  const started = Date.now();
  try {
    const sessionId = await poll(
      async () => {
        let sessionId: string | undefined;
        try {
          const targetId = await findServiceWorker(cdp, ext, 5_000);
          sessionId = String((await cdp.send('Target.attachToTarget', { targetId, flatten: true }, undefined, 5_000)).sessionId);
          await opts.onAttach?.(sessionId);
          const ready = await evaluate(cdp, sessionId, `typeof chrome !== 'undefined' && !!chrome.storage?.local`, undefined, 5_000);
          if (ready === true) return sessionId;
          failures.push('chrome.storage.local not available yet');
        } catch (e) {
          failures.push((e instanceof Error ? e.message : String(e)).slice(0, 200));
        }
        if (sessionId) await cdp.send('Target.detachFromTarget', { sessionId }, undefined, 5_000).catch(() => undefined);
        return undefined;
      },
      timeoutMs,
      'service worker ready',
    );
    // 需要重試時印出原因：用來觀察 Chrome 在這裡的行為（docs/verification.md）
    if (failures.length > 0)
      console.log(`ℹ service worker 附加重試 ${failures.length} 次（${Date.now() - started} ms）— ${[...new Set(failures)].join(' | ')}`);
    return sessionId;
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : String(e)} (last attempt: ${failures.at(-1) ?? 'no target'})`);
  }
}

// ---------------- Chrome 程序 ----------------

/** 整個 Chrome 程序樹強制結束。 */
export async function killChrome(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  }
  await waitExit(child, 10_000);
}

/** 正常關閉 Chrome；`Browser.close` 不回應或 Chrome 沒有結束就強制結束。 */
export async function closeChrome(child: ChildProcess, cdp: Cdp) {
  // Chrome 可能在回應 Browser.close 之前就關掉 pipe：那也算關閉成功
  await cdp.send('Browser.close', {}, undefined, 5_000).catch(() => undefined);
  if (!(await waitExit(child, 10_000))) await killChrome(child);
  cdp.close('Chrome closed');
}

function waitExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(t);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

/**
 * 整支腳本的上限：超過就印出訊息、強制結束 Chrome 並以失敗結束，避免某個沒有逾時的等待讓腳本永遠不結束。
 * `VERIFY_TIMEOUT_MS` 可以覆寫。回傳的函式解除這個上限。
 */
export function watchdog(name: string, timeoutMs: number, children: () => (ChildProcess | undefined)[]): () => void {
  const ms = Number(process.env.VERIFY_TIMEOUT_MS) || timeoutMs;
  const t = setTimeout(() => {
    console.error(
      `\n✗ ${name}: still running after ${Math.round(ms / 1000)} s — killing Chrome and exiting (set VERIFY_TIMEOUT_MS to change)`,
    );
    void Promise.all(children().map((c) => (c ? killChrome(c) : undefined))).finally(() => process.exit(1));
  }, ms);
  t.unref();
  return () => clearTimeout(t);
}
