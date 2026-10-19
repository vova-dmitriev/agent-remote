import { CommandStatus, ErrorCode, FrameType, SocketCloseCode, type ServerFrame } from '@protocol';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createRelay } from '../apps/server/src/app/create-relay.js';
import { AuthRepository } from '../apps/server/src/auth/repository.js';
import { ServerErrorCode } from '../apps/server/src/error-codes.js';
import {
  AUTH_RECHECK_CHUNK,
  AUTH_RECHECK_MAX_FAILURES,
  AUTH_RECHECK_MS,
  COMMAND_ACK_SWEEP_MS,
  COMMAND_ACK_TIMEOUT_MS,
} from '../apps/server/src/maintenance/limits.js';
import { RelayHub, type AppConnection } from '../apps/server/src/realtime/relay-hub.js';
import { attachmentRelayFixture } from './helpers/attachment-relay.js';
import { databaseFixture } from './helpers/database.js';
import { testBotToken } from './helpers/telegram.js';

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }

  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Waits on real I/O turns, without moving the fake clock, until a condition holds or 200 turns pass. */
async function settled(condition: () => boolean) {
  for (let turn = 0; turn < 200 && !condition(); turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Only the maintenance intervals and the clock are fake: sockets, PostgreSQL and Redis run on real I/O. */
const fakeMaintenanceClock = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });

for (const redis of [false, true]) {
  it(`marks unacknowledged commands within the ack sweep interval ${redis ? 'with' : 'without'} Redis`, async () => {
    fakeMaintenanceClock();
    const fixture = await databaseFixture();

    cleanups.push(() => fixture.close());

    const relay = await createRelay({
      databaseUrl: fixture.url,
      schema: fixture.schema,
      botToken: testBotToken,
      publicOrigin: 'http://127.0.0.1:4173',
      ...(redis ? { redisUrl: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380' } : {}),
    });

    cleanups.push(() => relay.close());

    const owner = randomUUID();
    const { db } = fixture;

    await db.pool.query("INSERT INTO users(id,telegram_id,created_at) VALUES($1,'7201',1)", [owner]);

    await db.pool.query("INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('d',$1,'h','g')", [
      owner,
    ]);

    await db.pool.query(
      "INSERT INTO command_audit(owner_id,command_id,device_id,session_id,action,fingerprint,status,created_at) VALUES($1,'c','d','s','prompt','f',$2,$3)",
      [owner, CommandStatus.Accepted, Date.now() - COMMAND_ACK_TIMEOUT_MS - 1],
    );

    const status = async () =>
      (await db.pool.query("SELECT status,code FROM command_audit WHERE command_id='c'")).rows[0];

    expect(await status()).toEqual({ status: CommandStatus.Accepted, code: null });

    await vi.advanceTimersByTimeAsync(COMMAND_ACK_SWEEP_MS);

    await expect
      .poll(status, { interval: 10, timeout: 2_000 })
      .toEqual({ status: CommandStatus.Unknown, code: ErrorCode.ACK_TIMEOUT });
  });
}

it('sends no frames to a socket whose token expired while it waits to be closed', () => {
  const hub = new RelayHub({} as never, {} as never);
  const send = vi.spyOn(hub.sender, 'send').mockReturnValue(true);

  const client = (expiresAt: number) =>
    ({
      socket: { expiresAt } as never,
      principal: { userId: 'owner', telegramId: 't' },
      token: 'token',
      expiresAt,
      deviceId: 'device',
      sessionId: null,
      selected: true,
    }) satisfies AppConnection;

  const expired = client(Date.now());
  const current = client(Date.now() + 1_000);

  hub.clients.add(expired);
  hub.clients.add(current);
  hub.fanout('owner', 'device', { type: FrameType.Authenticated } as ServerFrame);

  expect(send.mock.calls.map(([socket]) => socket)).toEqual([current.socket]);
});

it('closes every app socket after consecutive failed rechecks, and a success resets the count', async () => {
  fakeMaintenanceClock();
  const f = await attachmentRelayFixture();

  cleanups.push(() => f.close());

  const sockets = await Promise.all(
    [1, 2].map(async () => {
      const connection = f.connect('/ws/app', f.token);

      const closed = new Promise<{ code: number; reason: string }>((resolve) =>
        connection.socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
      );

      await connection.next(FrameType.Authenticated);

      return { ...connection, closed };
    }),
  );

  const { pool } = f.relay.db;
  const query = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
  let failing = true;

  vi.spyOn(pool, 'query').mockImplementation(((...args: unknown[]) =>
    failing && String(args[0]).includes('token_hash=ANY')
      ? Promise.reject(new Error('synthetic recheck failure'))
      : query(...args)) as never);

  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

  const failures = () =>
    stderr.mock.calls.filter(([line]) => String(line).includes(ServerErrorCode.AUTH_RECHECK_FAILED));

  const open = () => sockets.every(({ socket }) => socket.readyState === socket.OPEN);

  // Two failures, one success, then two failures again: never three in a row.
  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS * (AUTH_RECHECK_MAX_FAILURES - 1));
  failing = false;
  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS);
  failing = true;
  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS * (AUTH_RECHECK_MAX_FAILURES - 1));
  await settled(() => failures().length === (AUTH_RECHECK_MAX_FAILURES - 1) * 2);

  expect(failures()).toHaveLength((AUTH_RECHECK_MAX_FAILURES - 1) * 2);
  expect(open()).toBe(true);

  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS);

  for (const { closed } of sockets) {
    expect(await closed).toEqual({
      code: SocketCloseCode.TryAgainLater,
      reason: ErrorCode.SERVICE_UNAVAILABLE,
    });
  }

  expect(failures()).toHaveLength((AUTH_RECHECK_MAX_FAILURES - 1) * 2 + 1);
});

it('rechecks tokens in chunks and finds stored tokens in every chunk', async () => {
  const fixture = await databaseFixture();

  cleanups.push(() => fixture.close());

  const { db } = fixture;
  const owner = randomUUID();
  const hashes = Array.from({ length: AUTH_RECHECK_CHUNK + 500 }, (_, index) => `hash-${index}`);
  const stored = [hashes[0]!, hashes[AUTH_RECHECK_CHUNK + 200]!];
  const expiresAt = Date.now() + 60_000;

  await db.pool.query("INSERT INTO users(id,telegram_id,created_at) VALUES($1,'7202',1)", [owner]);

  for (const tokenHash of stored) {
    await db.pool.query('INSERT INTO auth_sessions(token_hash,owner_id,expires_at) VALUES($1,$2,$3)', [
      tokenHash,
      owner,
      expiresAt,
    ]);
  }

  const spy = vi.spyOn(db.pool, 'query');
  const found = await new AuthRepository(db).unexpired(hashes, Date.now());

  expect(spy).toHaveBeenCalledTimes(2);

  expect(spy.mock.calls.map(([, values]) => (values as string[][])[0]!.length)).toEqual([
    AUTH_RECHECK_CHUNK,
    500,
  ]);

  expect(found).toEqual(new Map(stored.map((tokenHash) => [tokenHash, expiresAt])));
});
