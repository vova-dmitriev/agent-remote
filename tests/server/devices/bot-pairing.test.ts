import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { databaseFixture } from '../../helpers/database.js';
import { NotificationWorker } from '@server/notifications/worker.js';
import { DeviceRepository } from '@server/devices/repositories/devices.js';
import { PairingRepository } from '@server/devices/repositories/pairings.js';
import { DeviceService } from '@server/devices/service.js';
import { hash } from '@server/auth/security.js';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
let devices: DeviceService;
let worker: NotificationWorker;
let offset = 1;

beforeAll(async () => {
  fixture = await databaseFixture();
  devices = new DeviceService(new DeviceRepository(fixture.db), new PairingRepository(fixture.db));

  worker = new NotificationWorker(fixture.db, 'synthetic', 'https://example.invalid', async () => {
    throw new Error('LIVE_TRANSPORT_FORBIDDEN');
  });
});

afterAll(async () => {
  await fixture?.close();
});

async function pairing() {
  const code = randomBytes(16).toString('hex'),
    proof = randomBytes(32).toString('hex');

  await devices.start(hash(code), hash(proof));

  return { code, proof };
}

async function start(code: string, id = 101, chatId = id, type = 'private') {
  await worker.updates([
    {
      update_id: offset++,
      message: { text: '/start pair_' + code, from: { id }, chat: { id: chatId, type } },
    },
  ]);
}

it('claims a private sender deep link and keeps the same claim on Telegram replay', async () => {
  const { code, proof } = await pairing();

  await start(code);
  const first = await devices.status(proof);

  expect(first.telegramId).toBe('101');
  expect(first.claimId).toBeTruthy();
  await start(code);
  expect(await devices.status(proof)).toEqual(first);

  const outbox = await fixture.db.pool.query(
    "SELECT kind FROM notification_outbox WHERE kind='pair_pending'",
  );

  expect(outbox.rows).toEqual([{ kind: 'pair_pending' }]);
});

it('ignores group messages and sender/chat mismatches', async () => {
  const { code, proof } = await pairing();

  await start(code, 201, -201, 'group');
  await start(code, 201, 202);
  expect((await devices.status(proof)).claimId).toBeNull();
});

it('does not transfer a claim to a competing private user', async () => {
  const { code, proof } = await pairing();

  await Promise.all([start(code, 301), start(code, 302)]);
  const first = await devices.status(proof);

  expect(['301', '302']).toContain(first.telegramId);
  await start(code, first.telegramId === '301' ? 302 : 301);
  expect(await devices.status(proof)).toEqual(first);
});

it('rejects expired and consumed links, including after revoking the paired device', async () => {
  const expired = await pairing();

  await fixture.db.pool.query('UPDATE pairings SET expires_at=0 WHERE code_hash=$1', [hash(expired.code)]);
  await start(expired.code, 401);

  expect(
    (await fixture.db.pool.query('SELECT owner_id FROM pairings WHERE code_hash=$1', [hash(expired.code)]))
      .rows[0].owner_id,
  ).toBeNull();

  const live = await pairing();

  await start(live.code, 402);
  const claim = await devices.status(live.proof);
  const device = await devices.confirm(live.proof, claim.claimId!, true);

  const owner = (await fixture.db.pool.query('SELECT id FROM users WHERE telegram_id=$1', ['402'])).rows[0]
    .id;

  await devices.revoke({ userId: owner, telegramId: '402' }, device!.deviceId);
  await start(live.code, 402);
  await expect(devices.status(live.proof)).rejects.toThrow('NOT_FOUND');
  expect(await devices.list({ userId: owner, telegramId: '402' })).toEqual([]);
});

it('cancels only the pairing identified by the local proof', async () => {
  const { code, proof } = await pairing();

  await devices.cancel('wrong');
  expect((await devices.status(proof)).claimId).toBeNull();
  await devices.cancel(proof);
  await start(code, 501);
  await expect(devices.status(proof)).rejects.toThrow('NOT_FOUND');
});

it('same-user claim replay still enforces expiry and consumption', async () => {
  const { code, proof } = await pairing();
  const id = randomUUID();

  await fixture.db.pool.query('INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,0)', [id, '601']);
  const principal = { userId: id, telegramId: '601' };
  const first = await devices.claim(principal, code);

  expect(await devices.claim(principal, code)).toEqual(first);
  await fixture.db.pool.query('UPDATE pairings SET expires_at=0 WHERE proof_hash=$1', [hash(proof)]);
  await expect(devices.claim(principal, code)).rejects.toThrow('PAIRING_UNAVAILABLE');
});

it('explains the active Mac quota and allows a fresh code after revocation', async () => {
  const first = await pairing();

  await start(first.code, 701);
  const status = await devices.status(first.proof);
  const device = await devices.confirm(first.proof, status.claimId!, true);
  const second = await pairing();

  await start(second.code, 701);
  expect((await devices.status(second.proof)).claimId).toBeNull();

  const owner = (await fixture.db.pool.query('SELECT id FROM users WHERE telegram_id=$1', ['701'])).rows[0]
    .id;

  expect(
    (await fixture.db.pool.query('SELECT kind FROM notification_outbox WHERE owner_id=$1', [owner])).rows,
  ).toContainEqual({ kind: 'pair_quota' });

  await devices.revoke({ userId: owner, telegramId: '701' }, device!.deviceId);
  await start(second.code, 701);
  expect((await devices.status(second.proof)).telegramId).toBe('701');
});
