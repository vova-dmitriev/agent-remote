import { ErrorCode, FrameType, SocketCloseCode, SocketCloseReason } from '@protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hash } from '@server/auth/security.js';
import { AUTH_RECHECK_MS } from '@server/maintenance/limits.js';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

// Only the maintenance intervals and the clock are fake: sockets, PostgreSQL and frame waits run on real I/O.
let f: Awaited<ReturnType<typeof attachmentRelayFixture>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  f = await attachmentRelayFixture();
});

afterEach(async () => {
  await f?.close();
  vi.useRealTimers();
});

async function app(token = f.token) {
  const connection = f.connect('/ws/app', token);

  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    connection.socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
  );

  let isClosed = false;

  void closed.then(() => {
    isClosed = true;
  });

  await connection.next(FrameType.Authenticated);

  return { ...connection, closed, isClosed: () => isClosed };
}

const authQueries = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('auth_sessions')).length;

/** Lets socket close frames and PostgreSQL replies arrive without moving the fake clock. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function expireAt(expiresAt: number) {
  await f.database.db.pool.query('UPDATE auth_sessions SET expires_at=$1 WHERE token_hash=$2', [
    expiresAt,
    hash(f.token),
  ]);
}

it('checks 100 open app sockets against PostgreSQL once per recheck interval, not every second', async () => {
  const sockets = await Promise.all(Array.from({ length: 100 }, () => app()));
  const spy = vi.spyOn(f.relay.db.pool, 'query');

  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS - 1_000);
  expect(authQueries(spy)).toBe(0);

  await vi.advanceTimersByTimeAsync(1_000);
  expect(authQueries(spy)).toBe(1);
  expect(sockets.every((socket) => !socket.isClosed())).toBe(true);
});

it('closes an expired token within a second with TOKEN_EXPIRED and no query', async () => {
  await expireAt(Date.now() + 5_000);
  const socket = await app();
  const spy = vi.spyOn(f.relay.db.pool, 'query');

  await vi.advanceTimersByTimeAsync(4_999);
  await settle();
  expect(socket.isClosed()).toBe(false);

  await vi.advanceTimersByTimeAsync(1_000);

  expect(await socket.closed).toEqual({
    code: SocketCloseCode.Unauthorized,
    reason: SocketCloseReason.TokenExpired,
  });

  expect(authQueries(spy)).toBe(0);
});

it('closes a token revoked on another instance at the next recheck', async () => {
  const socket = await app();

  await f.database.db.pool.query('DELETE FROM auth_sessions WHERE token_hash=$1', [hash(f.token)]);

  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS - 1_000);
  await settle();
  expect(socket.isClosed()).toBe(false);

  await vi.advanceTimersByTimeAsync(1_000);

  expect(await socket.closed).toEqual({
    code: SocketCloseCode.Unauthorized,
    reason: SocketCloseReason.TokenExpired,
  });
});

it('rejects and closes a revoked token on its next frame without waiting for the recheck', async () => {
  const socket = await app();

  await f.database.db.pool.query('DELETE FROM auth_sessions WHERE token_hash=$1', [hash(f.token)]);
  socket.send({ type: FrameType.Subscribe, deviceId: f.deviceId, sessionId: null });

  expect(await socket.next(FrameType.Error)).toMatchObject({ code: ErrorCode.UNAUTHORIZED });

  expect(await socket.closed).toEqual({
    code: SocketCloseCode.Unauthorized,
    reason: SocketCloseReason.TokenExpired,
  });
});

it('never extends a connection past the expiry it authenticated with', async () => {
  const expiresAt = Date.now() + AUTH_RECHECK_MS + 10_000;

  await expireAt(expiresAt);
  const socket = await app();

  // A later, longer expiry in storage (seen by a frame and by the recheck) must not move the socket's deadline.
  await expireAt(expiresAt + 3_600_000);
  socket.send({ type: FrameType.Subscribe, deviceId: f.deviceId, sessionId: null });
  await socket.next(FrameType.Snapshot);

  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS);
  await settle();
  expect(socket.isClosed()).toBe(false);

  await vi.advanceTimersByTimeAsync(expiresAt - Date.now());

  expect(await socket.closed).toEqual({
    code: SocketCloseCode.Unauthorized,
    reason: SocketCloseReason.TokenExpired,
  });
});
