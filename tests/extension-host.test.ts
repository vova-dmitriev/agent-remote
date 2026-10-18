import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, FrameType, LocalKind, LocalOperation } from '../packages/protocol/src/index.js';
import { broker } from './extension-client.fixture.js';

afterEach(() => vi.useRealTimers());

describe('extension viewer connection', () => {
  it('accepts a broker grant and rejects stale lease events', async () => {
    const viewer = broker();
    const frames: unknown[] = [];

    viewer.connection.subscribe((frame) => frames.push(frame));
    await viewer.ready();

    viewer.reply({
      kind: LocalKind.Event,
      lease: 'old',
      frame: { type: FrameType.Error, code: ErrorCode.OFFLINE },
    });

    viewer.reply({
      kind: LocalKind.Event,
      lease: 'lease-1',
      frame: { type: FrameType.Error, code: ErrorCode.OFFLINE },
    });

    expect(frames).toHaveLength(1);
    expect(viewer.stored).toEqual({});
    viewer.connection.close();
  });

  it('matches responses and preserves not-found status for receipt recovery', async () => {
    const viewer = broker();

    await viewer.ready();
    const request = viewer.connection.request({ operation: LocalOperation.Receipt, commandId: 'missing' });
    const rejected = expect(request).rejects.toMatchObject({ message: ErrorCode.NOT_FOUND, status: 404 });
    const message = viewer.sent.at(-1)!;

    expect(message.lease).toBe('lease-1');

    viewer.reply({
      kind: LocalKind.Result,
      requestId: message.requestId,
      ok: false,
      code: ErrorCode.NOT_FOUND,
    });

    await rejected;
    viewer.connection.close();
  });

  it('rejects in-flight work on disconnect without replaying mutations', async () => {
    const viewer = broker();

    await viewer.ready();

    const rejected = expect(
      viewer.connection.request({ operation: LocalOperation.PreferencesSave, patch: { language: 'en' } }),
    ).rejects.toThrow(ErrorCode.NETWORK_UNAVAILABLE);

    viewer.port.disconnect();
    await rejected;
    expect(viewer.sent).toHaveLength(2);
    expect(viewer.connection.grant).toBeNull();
    viewer.connection.close();
  });

  it('bounds pending work and ignores responses after cancellation', async () => {
    const viewer = broker();

    await viewer.ready();
    const controller = new AbortController();

    const cancelled = expect(
      viewer.connection.request({ operation: LocalOperation.Devices }, controller.signal),
    ).rejects.toThrow(ErrorCode.ATTACHMENT_CANCELLED);

    controller.abort();
    await cancelled;

    const requests = Array.from({ length: 64 }, () =>
      viewer.connection.request({ operation: LocalOperation.Devices }),
    );

    const settled = Promise.allSettled(requests);

    await expect(viewer.connection.request({ operation: LocalOperation.Devices })).rejects.toThrow(
      ErrorCode.IPC_BUSY,
    );

    viewer.connection.close();
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
  });

  it('expires requests at the deadline and releases pending capacity', async () => {
    const viewer = broker();

    await viewer.ready();
    vi.useFakeTimers();
    const request = viewer.connection.request({ operation: LocalOperation.Devices });
    const rejected = expect(request).rejects.toThrow(ErrorCode.REQUEST_TIMEOUT);

    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    viewer.connection.close();
  });

  it('invalidates outstanding work when the grant is revoked', async () => {
    const viewer = broker();

    await viewer.ready();

    const rejected = expect(viewer.connection.request({ operation: LocalOperation.Devices })).rejects.toThrow(
      ErrorCode.LOCAL_GRANT_REVOKED,
    );

    viewer.reply({
      kind: LocalKind.Event,
      lease: 'lease-1',
      frame: { type: FrameType.Error, code: ErrorCode.LOCAL_GRANT_REVOKED },
    });

    await rejected;
    expect(viewer.connection.grant).toBeNull();
  });
});
