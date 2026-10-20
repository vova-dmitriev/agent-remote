import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Socket, connect } from 'node:net';
import type { Stats } from 'node:fs';
import { lstat, unlink } from 'node:fs/promises';
import { ErrorCode } from '@protocol';
import { LOCAL_SOCKET_LIMITS, prepareLocalSocket } from '@daemon/local/server/socket-path.js';

vi.mock('node:net', async (original) => ({
  ...(await original<typeof import('node:net')>()),
  connect: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ lstat: vi.fn(), unlink: vi.fn() }));

const path = '/synthetic-private/client.sock';
let probe: Socket;
let parent: Stats;
let socket: Stats;

beforeEach(() => {
  vi.resetAllMocks();
  probe = new Socket();

  parent = {
    uid: process.getuid?.() ?? 0,
    mode: 0o40700,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  } as Stats;

  socket = {
    uid: parent.uid,
    mode: 0o140600,
    ino: 1,
    dev: 1,
    isSocket: () => true,
    isSymbolicLink: () => false,
  } as Stats;

  vi.mocked(lstat).mockImplementation(async (target) => (target === path ? socket : parent));
  vi.mocked(connect).mockReturnValue(probe);
});

afterEach(() => {
  probe.destroy();
  vi.useRealTimers();
});

it.each(['socket', 'parent'])('refuses a foreign-owned %s before probing or unlinking', async (target) => {
  const metadata = target === 'socket' ? socket : parent;

  metadata.uid++;
  await expect(prepareLocalSocket(path)).rejects.toThrow(ErrorCode.UNAUTHORIZED);
  expect(connect).not.toHaveBeenCalled();
  expect(unlink).not.toHaveBeenCalled();
});

it.each(['EACCES', 'ENOENT', 'EAGAIN'])(
  'does not remove a path after ambiguous probe failure %s',
  async (code) => {
    const attempt = prepareLocalSocket(path);
    const failure = expect(attempt).rejects.toThrow(ErrorCode.LOCAL_COMPANION_MISMATCH);

    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    probe.emit('error', Object.assign(new Error('synthetic probe error'), { code }));
    await failure;
    expect(unlink).not.toHaveBeenCalled();
    expect(probe.destroyed).toBe(true);
  },
);

it('bounds an unresponsive probe and preserves the existing path', async () => {
  vi.useFakeTimers();
  const attempt = prepareLocalSocket(path);
  const failure = expect(attempt).rejects.toThrow(ErrorCode.LOCAL_COMPANION_TIMEOUT);

  await vi.advanceTimersByTimeAsync(LOCAL_SOCKET_LIMITS.probeTimeoutMs + 1);
  await failure;
  expect(unlink).not.toHaveBeenCalled();
  expect(probe.destroyed).toBe(true);
});

it.each(['ino', 'dev'] as const)(
  'preserves a replacement whose %s changed during the probe',
  async (field) => {
    const attempt = prepareLocalSocket(path);
    const failure = expect(attempt).rejects.toThrow(ErrorCode.UNAUTHORIZED);

    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    socket = { ...socket, [field]: socket[field] + 1 };
    probe.emit('error', Object.assign(new Error('synthetic stale socket'), { code: 'ECONNREFUSED' }));
    await failure;
    expect(unlink).not.toHaveBeenCalled();
  },
);
