import { afterEach, expect, it, vi } from 'vitest';
import { ErrorCode, FrameType, LOCAL_LIMITS, type ServerFrame } from '@protocol';
import { reconnectingConnector } from '@desktop/runtime/reconnecting.js';
import type { DesktopSocketClient } from '@desktop/runtime/socket-client.js';

afterEach(() => {
  vi.useRealTimers();
});

/** A synthetic companion connection that can be dropped and that answers requests with its own name. */
function client(name: string) {
  const listeners = new Set<(frame: ServerFrame) => void>();
  let drop!: () => void;
  const closed = new Promise<void>((resolve) => (drop = resolve));

  const value: DesktopSocketClient = {
    request: async () => name,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    close: async () => drop(),
    closed,
  };

  return { value, drop, emit: (frame: ServerFrame) => listeners.forEach((listener) => listener(frame)) };
}

const error = (code: string): ServerFrame => ({ type: FrameType.Error, code }) as ServerFrame;

it('opens the companion again after it drops, keeps subscribers, and holds requests until it is back', async () => {
  vi.useFakeTimers();
  const first = client('first');
  const second = client('second');

  const open = vi
    .fn()
    .mockResolvedValueOnce(first.value)
    .mockRejectedValueOnce(new Error('synthetic'))
    .mockResolvedValue(second.value);

  const connector = await reconnectingConnector(open);
  const frames: ServerFrame[] = [];

  connector.subscribe((frame) => frames.push(frame));
  expect(await connector.request({} as never)).toBe('first');

  first.drop();
  await vi.advanceTimersByTimeAsync(0);
  const waiting = connector.request({} as never);

  await vi.advanceTimersByTimeAsync(20_000);
  expect(open).toHaveBeenCalledTimes(3);
  expect(await waiting).toBe('second');

  second.emit(error('after'));
  expect(frames).toEqual([error('after')]);
});

it('fails a request with LOCAL_HOST_UNAVAILABLE when the companion stays away past the request timeout', async () => {
  vi.useFakeTimers();
  const first = client('first');
  const open = vi.fn().mockResolvedValueOnce(first.value).mockRejectedValue(new Error('synthetic'));
  const connector = await reconnectingConnector(open);

  first.drop();
  await vi.advanceTimersByTimeAsync(0);
  const waiting = connector.request({} as never);
  const settled = expect(waiting).rejects.toThrow(ErrorCode.LOCAL_HOST_UNAVAILABLE);

  await vi.advanceTimersByTimeAsync(LOCAL_LIMITS.requestTimeoutMs);
  await settled;
  await connector.close();
});

it('replays the latest frame to a late subscriber and stops reconnecting once closed', async () => {
  vi.useFakeTimers();
  const first = client('first');
  const open = vi.fn().mockResolvedValue(first.value);
  const connector = await reconnectingConnector(open);
  const late = vi.fn();

  first.emit(error('snapshot'));
  connector.subscribe(late);
  expect(late).toHaveBeenCalledWith(error('snapshot'));

  await connector.close();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(open).toHaveBeenCalledTimes(1);
});
