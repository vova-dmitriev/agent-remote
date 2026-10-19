import { createHash, randomBytes } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { WebSocket } from 'ws';
import type { AppSnapshot } from '@protocol';
import { PAIR_DEVICE_IDS } from '../../../apps/mini-app/src/features/pair-device/config/test-ids.js';
import { deviceFixture, delivered } from '../support/relay-fixture.js';

export async function pairReplacementDevice(page: Page, snapshot: AppSnapshot) {
  const code = randomBytes(16).toString('hex');
  const proof = randomBytes(32).toString('hex');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');

  const start = await page.request.post('http://127.0.0.1:3000/device/pair/start', {
    data: { codeHash: hash(code), proofHash: hash(proof) },
  });

  expect(start.ok()).toBe(true);
  await page.getByTestId(PAIR_DEVICE_IDS.manual).click();
  await page.getByTestId(PAIR_DEVICE_IDS.code).fill(code);
  await page.getByTestId(PAIR_DEVICE_IDS.submit).click();
  await expect(page.getByTestId(PAIR_DEVICE_IDS.code)).toHaveValue('');
  const status = await page.request.post('http://127.0.0.1:3000/device/pair/status', { data: { proof } });
  const claim = (await status.json()) as { claimId: string };

  expect(claim.claimId).toBeTruthy();

  const confirmation = await page.request.post('http://127.0.0.1:3000/device/pair/confirm', {
    data: { proof, claimId: claim.claimId, approved: true },
  });

  const device = (await confirmation.json()) as { deviceId: string; token: string };
  const { relay, sockets } = deviceFixture();
  const socket = new WebSocket('ws://127.0.0.1:3000/ws/device');

  expect(confirmation.ok()).toBe(true);
  sockets[0] = socket;

  snapshot.sessions = snapshot.sessions.map((session) => ({
    ...session,
    target: { ...session.target, deviceId: device.deviceId },
  }));

  snapshot.permissions = [];

  await new Promise<void>((resolve, reject) => {
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: device.token })));
    socket.on('error', reject);

    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw));

      if (frame.type === 'authenticated') resolve();

      if (frame.type === 'command') {
        delivered.push(frame.command);

        socket.send(
          JSON.stringify({
            type: 'command_result',
            result: { commandId: frame.command.commandId, status: 'dispatched' },
          }),
        );
      }
    });
  });

  socket.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));

  await expect
    .poll(async () => {
      const result = await relay.db.pool.query('SELECT snapshot FROM devices WHERE id=$1', [device.deviceId]);

      return result.rows[0].snapshot;
    })
    .not.toBeNull();

  await expect(page.getByTestId(PAIR_DEVICE_IDS.root)).toHaveCount(0);

  return device.deviceId;
}
