import { beforeAll, afterAll, it, expect } from 'vitest';
import { Pool } from 'pg';
import { WebSocket } from 'ws';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRelay } from '../apps/server/src/relay.js';
import type { EventEnvelope } from '../packages/protocol/src/index.js';
import { initData, testBotToken } from './helpers/telegram.js';

const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test',
  schema = 'recover_' + randomUUID().replaceAll('-', '');

let relay: Awaited<ReturnType<typeof createRelay>>,
  origin: string,
  token: string,
  device: { deviceId: string; token: string };

const sockets: WebSocket[] = [];
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const p = new Pool({ connectionString: url });

  await p.query(`CREATE SCHEMA ${schema}`);
  await p.end();

  relay = await createRelay({
    databaseUrl: url,
    schema,
    botToken: testBotToken,
    publicOrigin: 'http://127.0.0.1:4173',
  });

  origin = await relay.listen(0);
  token = (await relay.auth.login(initData('8001'))).token;

  const code = randomBytes(16).toString('hex'),
    proof = randomBytes(32).toString('hex');

  await relay.devices.start(digest(code), digest(proof));
  const claim = await relay.devices.claim(await relay.auth.authenticate(token), code);

  device = (await relay.devices.confirm(proof, claim.claimId, true))!;
}, 30000);

afterAll(async () => {
  sockets.forEach((s) => s.terminate());
  await relay.close();
  const p = new Pool({ connectionString: url });

  await p.query(`DROP SCHEMA ${schema} CASCADE`);
  await p.end();
});

async function socket() {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws/device');

  sockets.push(ws);
  await new Promise<void>((r) => ws.once('open', () => r()));

  return ws;
}

it('does not replace a healthy device with an already closed socket after delayed authentication', async () => {
  const first = await socket();

  first.send(JSON.stringify({ type: 'auth', token: device.token }));
  await new Promise((r) => first.once('message', r));
  const healthy = relay.live.get(device.deviceId)!;
  const original = relay.devices.authenticate.bind(relay.devices);
  let release!: () => void, entered!: () => void;

  const gate = new Promise<void>((r) => (release = r)),
    start = new Promise<void>((r) => (entered = r));

  relay.devices.authenticate = async (...args) => {
    const value = await original(...args);

    entered();
    await gate;

    return value;
  };

  const second = await socket();

  second.send(JSON.stringify({ type: 'auth', token: device.token }));
  await start;
  second.terminate();
  await wait(50);
  release();
  await wait(150);
  relay.devices.authenticate = original;
  expect(relay.live.get(device.deviceId)).toBe(healthy);
  expect(first.readyState).toBe(WebSocket.OPEN);
});

it('paginates history without losing rows sharing the same timestamp', async () => {
  const principal = await relay.auth.authenticate(token);

  await relay.db.pool.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
    principal.userId,
    device.deviceId,
    'history',
    {},
  ]);

  for (let n = 1; n <= 205; n++) {
    const event = {
      version: 1,
      deviceId: device.deviceId,
      streamId: 'history',
      seq: n,
      eventId: String(n).padStart(4, '0'),
      sessionId: 'history',
      occurredAt: 123,
      type: 'message',
      payload: { id: String(n), role: 'assistant', text: 'synthetic', occurredAt: 123 },
    };

    await relay.db.pool.query(
      'INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,session_id,occurred_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [principal.userId, device.deviceId, 'history', n, event.eventId, 'history', 123, event],
    );
  }

  const all: string[] = [];
  let cursor = '';

  do {
    const res = await fetch(
      origin + '/sessions/history/events' + (cursor ? '?before=' + encodeURIComponent(cursor) : ''),
      { headers: { authorization: 'Bearer ' + token } },
    );

    expect(res.status).toBe(200);
    all.push(...((await res.json()) as EventEnvelope[]).map((e) => e.eventId));
    cursor = res.headers.get('x-next-cursor') ?? '';
  } while (cursor);

  expect(new Set(all).size).toBe(205);
});
