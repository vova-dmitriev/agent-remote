import { createHash, randomBytes } from 'node:crypto';
import { FrameType } from '@protocol';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createRelay } from '../apps/server/src/relay.js';
import { databaseFixture } from './helpers/database.js';
import { initData, testBotToken } from './helpers/telegram.js';

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

  try {
    const relay = await createRelay({
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

    const closed = sockets.map(
      (socket) => new Promise<void>((resolve) => socket.once('close', () => resolve())),
    );

    await relay.close();
    await Promise.all(closed);

    expect(intervalsWhileRunning).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
