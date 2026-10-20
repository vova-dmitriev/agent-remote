import { Logger } from '@nestjs/common';
import { CommandStatus, ErrorCode, FrameType, SocketCloseCode, type ServerFrame } from '@protocol';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createRelay } from '../../../apps/server/src/app/create-relay.js';
import { AuthRepository } from '../../../apps/server/src/auth/repository.js';
import { ServerErrorCode } from '../../../apps/server/src/error-codes.js';
import {
  AUTH_RECHECK_CHUNK,
  AUTH_RECHECK_MAX_FAILURES,
  AUTH_RECHECK_MS,
  COMMAND_ACK_SWEEP_MS,
  COMMAND_ACK_TIMEOUT_MS,
} from '../../../apps/server/src/maintenance/limits.js';
import { RelayHub, type AppConnection } from '../../../apps/server/src/realtime/relay-hub.js';
import { attachmentRelayFixture } from '../../helpers/attachment-relay.js';
import { databaseFixture } from '../../helpers/database.js';
import { testBotToken } from '../../helpers/telegram.js';

/** The batched token recheck, whether pg gets a string or the `{ text }` config the query builder passes. */
const isRecheck = (query: unknown) => {
  const text =
    typeof query === 'string' ? query : String((query as { text?: unknown } | undefined)?.text ?? '');

  return text.includes('"auth_sessions"') && text.includes('"token_hash" in (');
};

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }

  vi.restoreAllMocks();
  vi.useRealTimers();
});

const SETTLE_TIMEOUT_MS = 5_000;
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

/** Waits on real I/O, without moving the fake clock, until a condition holds or 5 s of real time pass. */
async function settled(condition: () => boolean) {
  const deadline = performance.now() + SETTLE_TIMEOUT_MS;

  while (!condition() && performance.now() < deadline) {
    await nextTurn();
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

async function openApp(f: Awaited<ReturnType<typeof attachmentRelayFixture>>) {
  const connection = f.connect('/ws/app', f.token);

  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    connection.socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
  );

  await connection.next(FrameType.Authenticated);

  return { ...connection, closed };
}

/** A relay whose token recheck query fails while `failing()` is true; counts the logged failures. */
async function failingRecheck() {
  fakeMaintenanceClock();
  const f = await attachmentRelayFixture();

  cleanups.push(() => f.close());

  const { pool } = f.relay.db;
  const query = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
  const state = { failing: true, startedRechecks: 0, settledRechecks: 0 };

  vi.spyOn(pool, 'query').mockImplementation(((...args: unknown[]) => {
    if (!isRecheck(args[0])) {
      return query(...args);
    }

    state.startedRechecks++;
    const result = state.failing ? Promise.reject(new Error('synthetic recheck failure')) : query(...args);

    void result.then(
      () => state.settledRechecks++,
      () => state.settledRechecks++,
    );

    return result;
  }) as never);

  const warned = vi.spyOn(Logger, 'warn').mockImplementation(() => {});

  const failures = () =>
    warned.mock.calls.filter(([message]) => String(message).startsWith(ServerErrorCode.AUTH_RECHECK_FAILED))
      .length;

  return { f, state, failures };
}

it('closes every app socket after consecutive failed rechecks, and a success resets the count', async () => {
  const { f, state, failures } = await failingRecheck();
  const sockets = await Promise.all([openApp(f), openApp(f)]);
  const open = () => sockets.every(({ socket }) => socket.readyState === socket.OPEN);

  // Two failures, one success, then two failures again: never three in a row.
  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS * (AUTH_RECHECK_MAX_FAILURES - 1));
  state.failing = false;
  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS);
  // The successful recheck reads PostgreSQL; let it finish before the next failures count.
  await settled(() => state.settledRechecks === AUTH_RECHECK_MAX_FAILURES);
  state.failing = true;
  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS * (AUTH_RECHECK_MAX_FAILURES - 1));
  await settled(() => failures() === (AUTH_RECHECK_MAX_FAILURES - 1) * 2);

  expect(failures()).toBe((AUTH_RECHECK_MAX_FAILURES - 1) * 2);
  expect(open()).toBe(true);

  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS);

  for (const { closed } of sockets) {
    expect(await closed).toEqual({
      code: SocketCloseCode.TryAgainLater,
      reason: ErrorCode.SERVICE_UNAVAILABLE,
    });
  }

  expect(failures()).toBe((AUTH_RECHECK_MAX_FAILURES - 1) * 2 + 1);
});

it('does not carry recheck failures across a period without app sockets', async () => {
  const { f, state, failures } = await failingRecheck();
  const first = await openApp(f);

  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS * (AUTH_RECHECK_MAX_FAILURES - 1));
  await settled(() => failures() === AUTH_RECHECK_MAX_FAILURES - 1);
  first.socket.close();
  await first.closed;

  // An idle recheck finds no socket and queries nothing; the next socket starts from zero failures.
  // The relay may see the close after one more recheck, so advance until a recheck runs idle.
  let idle = false;

  for (let attempt = 0; attempt < AUTH_RECHECK_MAX_FAILURES && !idle; attempt++) {
    const started = state.startedRechecks;

    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS);
    await settled(() => state.settledRechecks === state.startedRechecks);

    idle = state.startedRechecks === started;
  }

  expect(idle).toBe(true);
  const before = failures();
  const second = await openApp(f);

  await vi.advanceTimersByTimeAsync(AUTH_RECHECK_MS);
  await settled(() => failures() === before + 1);

  expect(failures()).toBe(before + 1);
  expect(second.socket.readyState).toBe(second.socket.OPEN);
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

  // One parameter per hash plus `now`.
  expect(spy.mock.calls.map(([, values]) => (values as unknown[]).length - 1)).toEqual([
    AUTH_RECHECK_CHUNK,
    500,
  ]);

  expect(found).toEqual(new Map(stored.map((tokenHash) => [tokenHash, expiresAt])));
});
