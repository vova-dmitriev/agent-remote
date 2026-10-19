import { afterAll, beforeAll, expect, it } from 'vitest';
import { createRelay } from '../apps/server/src/relay.js';
import { databaseFixture } from './helpers/database.js';
import { testBotToken } from './helpers/telegram.js';

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
