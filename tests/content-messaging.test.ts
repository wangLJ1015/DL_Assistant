import { describe, expect, it, vi } from 'vitest';
import { createSender } from '../src/content/messaging';

const msg = { type: 'cartClicked', id: 'RJ01014447' } as const;

describe('content → background messaging', () => {
  it('returns the reply', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    expect(await createSender(send, 0)(msg)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries once (service worker starting up), then gives up quietly', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('Could not establish connection')).mockResolvedValue({ ok: true });
    expect(await createSender(send, 0)(msg)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
    const failing = vi.fn().mockRejectedValue(new Error('nope'));
    expect(await createSender(failing, 0)(msg)).toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('does not retry after the extension context is invalidated', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Extension context invalidated.'));
    expect(await createSender(send, 0)(msg)).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
