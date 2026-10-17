import { afterAll, beforeAll, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { databaseFixture } from './helpers/database.js';
import { createRelay } from '../apps/server/src/relay.js';
import { persistEvent } from '../apps/server/src/history/events.js';
import { initData, testBotToken } from './helpers/telegram.js';
import type { EventEnvelope } from '../packages/protocol/src/index.js';

const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380';
let fixture: Awaited<ReturnType<typeof databaseFixture>>;
let relay: Awaited<ReturnType<typeof createRelay>>;
let origin: string, token: string, foreign: string, deviceId: string;
const client = new Redis(redisUrl);

beforeAll(async () => {
  fixture = await databaseFixture();

  relay = await createRelay({
    databaseUrl: fixture.url,
    schema: fixture.schema,
    botToken: testBotToken,
    publicOrigin: 'http://127.0.0.1:4173',
    redisUrl,
  });

  origin = await relay.listen(0);
  token = (await relay.auth.login(initData('6001'))).token;
  foreign = (await relay.auth.login(initData('6002'))).token;
  const p = await relay.auth.authenticate(token);

  deviceId = randomUUID();

  await relay.db.pool.query('INSERT INTO devices(id,owner_id,token_hash,generation) VALUES($1,$2,$3,$4)', [
    deviceId,
    p.userId,
    randomUUID(),
    'generation',
  ]);

  await relay.db.pool.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
    p.userId,
    deviceId,
    'session',
    '{}',
  ]);
});

afterAll(async () => {
  client.disconnect();
  await relay?.close();
  await fixture?.close();
});

const read = (bearer = token) =>
  fetch(origin + '/sessions/session/events', { headers: { authorization: 'Bearer ' + bearer } });

function event(seq: number): EventEnvelope {
  return {
    version: 1,
    deviceId,
    streamId: 'stream',
    seq,
    eventId: 'event-' + seq,
    sessionId: 'session',
    occurredAt: Date.now(),
    type: 'message',
    payload: { id: String(seq), role: 'assistant', text: 'Synthetic history ' + seq, occurredAt: Date.now() },
  };
}

it('uses Redis history pages, versions new events atomically and authorizes warm-cache reads', async () => {
  const principal = await relay.auth.authenticate(token);

  await persistEvent(relay.db, principal.userId, event(1));
  expect((await (await read()).json()).length).toBe(1);
  const keys = await client.keys(`${relay.messaging!.prefix}:cache:*`);

  expect(keys.length).toBe(1);
  expect(await client.pttl(keys[0]!)).toBeGreaterThan(0);
  expect((await read(foreign)).status).toBe(404);
  const duplicate = event(1);

  expect(await persistEvent(relay.db, principal.userId, duplicate)).toBe(false);

  expect(
    (await relay.db.pool.query('SELECT history_revision FROM devices WHERE id=$1', [deviceId])).rows[0]
      .history_revision,
  ).toBe('1');

  await persistEvent(relay.db, principal.userId, event(2));
  expect((await (await read()).json()).length).toBe(2);
  await relay.devices.revoke(principal, deviceId);
  expect((await read()).status).toBe(404);
});
