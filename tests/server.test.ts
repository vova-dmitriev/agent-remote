import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { createRelay } from '../apps/server/src/relay.js';
import { initData, testBotToken } from './helpers/telegram.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const schema = 'test_' + randomUUID().replaceAll('-', '');

const url =
  process.env.TEST_DATABASE_URL ??
  'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test';

let relay: Awaited<ReturnType<typeof createRelay>>;
let origin: string;
let tokenA: string;
let tokenB: string;
let deviceId: string;
let deviceToken: string;
const headers = (token: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function post(path: string, body: unknown, token?: string) {
  return fetch(origin + path, {
    method: 'POST',
    headers: token ? headers(token) : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const admin = new Pool({ connectionString: url });

  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  relay = await createRelay({
    databaseUrl: url,
    schema,
    botToken: testBotToken,
    botUsername: 'fixture_bot',
    publicOrigin: 'http://127.0.0.1:4173',
    inputEnabled: true,
    permissionsEnabled: true,
  });

  origin = await relay.listen(0, '127.0.0.1');
}, 30_000);

afterAll(async () => {
  await relay?.close();
  const admin = new Pool({ connectionString: url });

  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe('real PostgreSQL relay', () => {
  it('validates Telegram signature, age and future dates without accepting supplied owner', async () => {
    for (const data of [
      initData('101', Date.now() - 301000),
      initData('101', Date.now() + 60000),
      initData('101') + 'bad',
    ]) {
      expect((await post('/auth/telegram', { initData: data })).status).toBe(401);
    }

    expect((await post('/auth/telegram', { initData: initData('101'), ownerId: 'fake' })).status).toBe(400);
    const a = await post('/auth/telegram', { initData: initData('101') });

    expect(a.status).toBe(200);
    const login = (await a.json()) as { token: string; expiresAt: number };

    tokenA = login.token;
    expect(login.expiresAt - Date.now()).toBeGreaterThan(899000);

    tokenB = (
      (await (await post('/auth/telegram', { initData: initData('202') })).json()) as { token: string }
    ).token;
  });

  it('publishes only bot metadata at registration and cancels using the local proof', async () => {
    const code = randomBytes(16).toString('hex'),
      proof = randomBytes(32).toString('hex');

    const registration = await post('/device/pair/start', { codeHash: hash(code), proofHash: hash(proof) });

    expect(await registration.json()).toEqual({ botUsername: 'fixture_bot', expiresAt: expect.any(Number) });
    expect((await post('/device/pair/cancel', { proof: 'wrong' })).status).toBe(200);
    expect((await post('/device/pair/status', { proof })).status).toBe(200);
    expect((await post('/device/pair/cancel', { proof })).status).toBe(200);
    expect((await post('/device/pair/status', { proof })).status).toBe(404);
  });

  it('pairs once only after local approval, fences proof and account quota', async () => {
    const code = randomBytes(16).toString('hex');
    const proof = randomBytes(32).toString('hex');

    expect((await post('/device/pair/start', { codeHash: hash(code), proofHash: hash(proof) })).status).toBe(
      200,
    );

    const claims = await Promise.all([
      post('/pair/claim', { code }, tokenA),
      post('/pair/claim', { code }, tokenB),
    ]);

    expect(claims.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = claims[0]!.status === 200 ? tokenA : tokenB;

    if (winner === tokenB) {
      [tokenA, tokenB] = [tokenB, tokenA];
    }

    const claim = (await claims.find((r) => r.status === 200)!.json()) as { claimId: string };

    expect(
      (await post('/device/pair/confirm', { proof: 'wrong', claimId: claim.claimId, approved: true })).status,
    ).toBe(404);

    const status = (await (await post('/device/pair/status', { proof })).json()) as { telegramId: string };

    expect(['101', '202']).toContain(status.telegramId);

    const confirmation = await post('/device/pair/confirm', {
      proof,
      claimId: claim.claimId,
      approved: true,
    });

    expect(confirmation.status).toBe(200);
    const device = (await confirmation.json()) as { deviceId: string; token: string };

    deviceId = device.deviceId;
    deviceToken = device.token;

    expect(
      (await post('/device/pair/confirm', { proof, claimId: claim.claimId, approved: true })).status,
    ).toBe(404);
  });

  it('isolates devices, snapshots, events, connectors and commands for two owners', async () => {
    expect((await fetch(origin + '/devices', { headers: headers(tokenA) })).status).toBe(200);
    expect(await (await fetch(origin + '/devices', { headers: headers(tokenB) })).json()).toEqual([]);

    for (const path of [
      `/devices/${deviceId}/snapshot`,
      `/devices/${deviceId}/connectors`,
      `/devices/${deviceId}/events?streamId=x&seq=0`,
    ]) {
      expect((await fetch(origin + path, { headers: headers(tokenB) })).status).toBe(404);
    }

    expect(
      (await fetch(origin + `/devices/${deviceId}`, { method: 'DELETE', headers: headers(tokenB) })).status,
    ).toBe(404);

    expect(
      (
        await post(
          '/commands',
          {
            commandId: randomUUID(),
            target: { kind: 'claude-code-cli', deviceId, connectorId: 'c', claudeSessionId: 's' },
            sessionId: 's',
            generation: 'g',
            action: { type: 'prompt', text: 'hello' },
          },
          tokenB,
        )
      ).status,
    ).toBe(404);

    expect(
      (await fetch(origin + `/devices/${deviceId}/snapshot`, { headers: headers(deviceToken) })).status,
    ).toBe(401);
  });

  it('logs out and immediately revokes the bearer', async () => {
    expect((await post('/auth/logout', {}, tokenB)).status).toBe(200);
    expect((await fetch(origin + '/devices', { headers: headers(tokenB) })).status).toBe(401);
  });
});
