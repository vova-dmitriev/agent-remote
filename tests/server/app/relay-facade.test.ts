import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestApplicationContext } from '@nestjs/core';
import { FrameType } from '@protocol';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createRelay, type Relay } from '@server/app/create-relay.js';
import { Database } from '@server/db/database.js';
import { Notifier } from '@server/notifications/notify.js';
import { NotificationQueue } from '@server/notifications/queue.js';
import { RealtimeModule } from '@server/realtime/realtime.module.js';
import { RelayModule } from '@server/app/relay.module.js';
import { databaseFixture } from '../../helpers/relay/database.js';
import { initData, testBotToken } from '../../helpers/relay/telegram.js';

const RELAY_KEYS = [
  'db',
  'messaging',
  'auth',
  'devices',
  'attachments',
  'command',
  'dispatchHandoffCreate',
  'replay',
  'live',
  'notify',
  'listen',
  'close',
];

let fixture: Awaited<ReturnType<typeof databaseFixture>>;

beforeAll(async () => {
  fixture = await databaseFixture();
});

afterAll(async () => {
  await fixture?.close();
});

it('keeps the relay facade shape, listens on an ephemeral port and stops serving after close', async () => {
  const relay = await createRelay({
    databaseUrl: fixture.url,
    schema: fixture.schema,
    botToken: testBotToken,
    publicOrigin: 'http://localhost',
  });

  let closed = false;

  try {
    expect(Object.keys(relay).sort()).toEqual([...RELAY_KEYS].sort());

    const origin = await relay.listen(0);

    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    expect(origin).not.toBe('http://127.0.0.1:0');
    expect((await fetch(origin + '/health')).ok).toBe(true);

    await relay.close();
    closed = true;

    await expect(fetch(origin + '/health')).rejects.toThrow();
  } finally {
    if (!closed) {
      await relay.close();
    }
  }
});

const PUBLIC_ORIGIN = 'http://localhost';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

const authenticatedSocket = (url: string, token: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url, { origin: PUBLIC_ORIGIN });

    socket.on('open', () => socket.send(JSON.stringify({ type: FrameType.Auth, token })));
    socket.on('error', reject);

    socket.on('message', (data) => {
      if ((JSON.parse(String(data)) as { type: string }).type === FrameType.Authenticated) {
        resolve(socket);
      }
    });
  });

it('closes app and device sockets and clears the maintenance intervals on close', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let relay: Relay | undefined;
  let closed = false;

  try {
    relay = await createRelay({
      databaseUrl: fixture.url,
      schema: fixture.schema,
      botToken: testBotToken,
      publicOrigin: PUBLIC_ORIGIN,
    });

    const intervalsWhileRunning = vi.getTimerCount();
    const origin = (await relay.listen(0)).replace('http:', 'ws:');
    const { token } = await relay.auth.login(initData('9101'));
    const code = randomBytes(16).toString('hex');
    const proof = randomBytes(32).toString('hex');

    await relay.devices.start(sha(code), sha(proof));
    const claim = await relay.devices.claim(await relay.auth.authenticate(token), code);
    const device = (await relay.devices.confirm(proof, claim.claimId, true))!;

    const sockets = await Promise.all([
      authenticatedSocket(origin + '/ws/app', token),
      authenticatedSocket(origin + '/ws/device', device.token),
    ]);

    const socketsClosed = sockets.map(
      (socket) => new Promise<void>((resolve) => socket.once('close', () => resolve())),
    );

    await relay.close();
    closed = true;
    await Promise.all(socketsClosed);

    // Liveness tick, token recheck, ack sweep and in-process retention (no Redis here).
    expect(intervalsWhileRunning).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    if (relay && !closed) {
      await relay.close();
    }

    vi.useRealTimers();
  }
});

const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380';

// A connection string whose PostgreSQL sessions can be counted by name.
const namedDatabaseUrl = (name: string) => {
  const url = new URL(fixture.url);

  url.searchParams.set('application_name', name);

  return url.href;
};

const openSessions = async (name: string) =>
  Number(
    (await fixture.db.pool.query('SELECT count(*) FROM pg_stat_activity WHERE application_name=$1', [name]))
      .rows[0].count,
  );

const startWithRedis = (databaseUrl: string) =>
  createRelay({
    databaseUrl,
    schema: fixture.schema,
    redisUrl: TEST_REDIS_URL,
    botToken: testBotToken,
    publicOrigin: PUBLIC_ORIGIN,
  });

it('releases its intervals, Redis and PostgreSQL when the application fails to initialize', async () => {
  const name = 'failed-init-' + randomUUID();
  const queueClose = vi.spyOn(NotificationQueue.prototype, 'close');

  const bootstrap = vi.spyOn(RealtimeModule.prototype, 'onApplicationBootstrap').mockImplementation(() => {
    throw new Error('BOOTSTRAP_FAILED');
  });

  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

  try {
    await expect(startWithRedis(namedDatabaseUrl(name))).rejects.toThrow('BOOTSTRAP_FAILED');

    expect(vi.getTimerCount()).toBe(0);
    expect(queueClose).toHaveBeenCalledTimes(1);
    await expect.poll(() => openSessions(name)).toBe(0);
  } finally {
    vi.useRealTimers();
    bootstrap.mockRestore();
    queueClose.mockRestore();
  }
});

it('rethrows the original startup error when releasing resources fails too', async () => {
  // The failure is expected: keep its error log out of the test output.
  const quiet = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => {});

  const name = 'failed-release-' + randomUUID();
  const close = Database.prototype.close;

  const dbClose = vi.spyOn(Database.prototype, 'close').mockImplementation(async function (this: Database) {
    await close.call(this);
    throw new Error('RELEASE_FAILED');
  });

  const bootstrap = vi.spyOn(RealtimeModule.prototype, 'onApplicationBootstrap').mockImplementation(() => {
    throw new Error('BOOTSTRAP_FAILED');
  });

  try {
    const failure = await startWithRedis(namedDatabaseUrl(name)).catch((error: unknown) => error);

    expect((failure as Error).message).toBe('BOOTSTRAP_FAILED');

    expect((failure as Error & { suppressed: Error[] }).suppressed.map((error) => error.message)).toEqual([
      'RELEASE_FAILED',
    ]);

    expect(dbClose).toHaveBeenCalledTimes(1);
    await expect.poll(() => openSessions(name)).toBe(0);
  } finally {
    quiet.mockRestore();
    bootstrap.mockRestore();
    dbClose.mockRestore();
  }
});

it('closes PostgreSQL when closing Redis fails, and attaches and logs that close error', async () => {
  const name = 'failed-messaging-close-' + randomUUID();
  const close = NotificationQueue.prototype.close;
  const logged = vi.spyOn(Logger, 'error').mockImplementation(() => {});
  const dbClose = vi.spyOn(Database.prototype, 'close');

  const queueClose = vi.spyOn(NotificationQueue.prototype, 'close').mockImplementation(async function (
    this: NotificationQueue,
  ) {
    await close.call(this);
    throw new Error('QUEUE_CLOSE_FAILED');
  });

  const bootstrap = vi.spyOn(RealtimeModule.prototype, 'onApplicationBootstrap').mockImplementation(() => {
    throw new Error('BOOTSTRAP_FAILED');
  });

  try {
    const failure = await startWithRedis(namedDatabaseUrl(name)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('BOOTSTRAP_FAILED');

    expect((failure as Error & { suppressed: Error[] }).suppressed.map((error) => error.message)).toEqual([
      'QUEUE_CLOSE_FAILED',
    ]);

    expect(queueClose).toHaveBeenCalledTimes(1);
    expect(dbClose).toHaveBeenCalledTimes(1);
    await expect.poll(() => openSessions(name)).toBe(0);
    expect(logged).toHaveBeenCalledWith('Error: QUEUE_CLOSE_FAILED', expect.any(String), 'RelayRelease');
  } finally {
    bootstrap.mockRestore();
    queueClose.mockRestore();
    dbClose.mockRestore();
    logged.mockRestore();
  }
});

it('releases Redis and PostgreSQL when a provider fails while the application is created', async () => {
  // The failure is expected: keep its error log out of the test output.
  const quiet = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => {});

  const name = 'failed-create-' + randomUUID();
  const queueClose = vi.spyOn(NotificationQueue.prototype, 'close');
  const register = RelayModule.register.bind(RelayModule);

  const broken = vi.spyOn(RelayModule, 'register').mockImplementation((resources) => {
    const module = register(resources);

    return {
      ...module,
      providers: [
        ...(module.providers ?? []),
        {
          provide: 'BROKEN_PROVIDER',
          useFactory: () => {
            throw new Error('PROVIDER_FAILED');
          },
        },
      ],
    };
  });

  try {
    await expect(startWithRedis(namedDatabaseUrl(name))).rejects.toThrow('PROVIDER_FAILED');

    expect(queueClose).toHaveBeenCalledTimes(1);
    await expect.poll(() => openSessions(name)).toBe(0);
  } finally {
    quiet.mockRestore();
    broken.mockRestore();
    queueClose.mockRestore();
  }
});

it('releases Redis and PostgreSQL when resolving a facade service fails after initialization', async () => {
  // The failure is expected: keep its error log out of the test output.
  const quiet = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => {});

  const name = 'failed-resolve-' + randomUUID();
  const queueClose = vi.spyOn(NotificationQueue.prototype, 'close');
  const get = NestApplicationContext.prototype.get;

  const resolve = vi.spyOn(NestApplicationContext.prototype, 'get').mockImplementation(function (
    this: NestApplicationContext,
    ...args: Parameters<typeof get>
  ) {
    if (args[0] === Notifier) {
      throw new Error('RESOLVE_FAILED');
    }

    return get.apply(this, args);
  });

  try {
    await expect(startWithRedis(namedDatabaseUrl(name))).rejects.toThrow('RESOLVE_FAILED');

    expect(queueClose).toHaveBeenCalledTimes(1);
    await expect.poll(() => openSessions(name)).toBe(0);
  } finally {
    quiet.mockRestore();
    resolve.mockRestore();
    queueClose.mockRestore();
  }
});
