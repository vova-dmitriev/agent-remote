import { test as base, expect } from '@playwright/test';
import { Pool } from 'pg';
import { WebSocket } from 'ws';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { NotificationWorker } from '../../../apps/server/src/notifications/worker.js';
import { createRelay } from '../../../apps/server/src/relay.js';
import { initData, testBotToken } from '../../helpers/telegram.js';
import type { ClientCommand, HistoryMessage } from '@protocol';
import { sessionSnapshot } from './session-fixtures.js';
import { commandOutcome, setCommandOutcome } from '../runtime/command-outcome.js';
import { appOrigin } from '../runtime/app-origin.js';

export { setCommandOutcome } from '../runtime/command-outcome.js';

const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test',
  schema = 'e2e_' + randomUUID().replaceAll('-', '');

let relay: Awaited<ReturnType<typeof createRelay>>;
const sockets: WebSocket[] = [];

export const delivered: ClientCommand[] = [];
let deviceId: string;
let deviceToken: string;
let heartbeat: ReturnType<typeof setInterval>;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function startRelay() {
  sockets.length = 0;
  delivered.length = 0;
  setCommandOutcome('dispatched');
  sequence = 0;
  const pool = new Pool({ connectionString: url });

  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.end();

  relay = await createRelay({
    databaseUrl: url,
    schema,
    botToken: testBotToken,
    publicOrigin: appOrigin,
    inputEnabled: true,
    permissionsEnabled: true,
  });

  await relay.listen(3000);
  const login = await relay.auth.login(initData('801'));

  const code = randomBytes(16).toString('hex'),
    proof = randomBytes(32).toString('hex');

  await relay.devices.start(sha(code), sha(proof));
  const claim = await relay.devices.claim(await relay.auth.authenticate(login.token), code);
  const device = (await relay.devices.confirm(proof, claim.claimId, true))!;

  deviceId = device.deviceId;
  deviceToken = device.token;
  const ws = new WebSocket('ws://127.0.0.1:3000/ws/device');

  sockets.push(ws);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: device.token })));
    ws.on('error', reject);

    ws.on('message', (raw) => {
      const frame = JSON.parse(String(raw));

      if (frame.type === 'authenticated') resolve();

      if (frame.type === 'command') {
        delivered.push(frame.command);

        if (commandOutcome() === 'held') return;

        ws.send(
          JSON.stringify({
            type: 'command_result',
            result: { commandId: frame.command.commandId, status: commandOutcome() },
          }),
        );
      }
    });
  });

  const snap = sessionSnapshot(deviceId);

  ws.send(JSON.stringify({ type: 'snapshot', snapshot: snap, connectors: [] }));
  heartbeat = setInterval(() => sockets[0]?.send(JSON.stringify({ type: 'heartbeat' })), 5000);

  await expect
    .poll(async () => Number((await relay.db.pool.query('SELECT count(*) FROM sessions')).rows[0].count))
    .toBe(4);
}

export function deviceFixture() {
  return { relay, sockets, deviceId, deviceToken };
}

let sequence = 0;

export async function publishMessages(messages: HistoryMessage[], sessionId = 'terminal-session') {
  for (let offset = 0; offset < messages.length; offset += 100) {
    for (const message of messages.slice(offset, offset + 100)) {
      const seq = ++sequence;

      sockets[0]!.send(
        JSON.stringify({
          type: 'event',
          event: {
            version: 1,
            deviceId,
            streamId: 'e2e',
            seq,
            eventId: 'message-event-' + seq,
            sessionId,
            occurredAt: message.occurredAt,
            type: 'message',
            payload: message,
          },
        }),
      );
    }

    await expect
      .poll(async () => Number((await relay.db.pool.query('SELECT max(seq) AS seq FROM events')).rows[0].seq))
      .toBe(sequence);
  }
}

export async function completeBotPairing(telegramId: number) {
  const code = randomBytes(16).toString('hex'),
    proof = randomBytes(32).toString('hex');

  await relay.devices.start(sha(code), sha(proof));
  const worker = new NotificationWorker(relay.db, testBotToken, appOrigin);

  await worker.updates([
    {
      update_id: 1,
      message: {
        text: '/start pair_' + code,
        from: { id: telegramId },
        chat: { id: telegramId, type: 'private' },
      },
    },
  ]);

  const status = await relay.devices.status(proof);

  if (!status.claimId) throw new Error('SYNTHETIC_PAIRING_NOT_CLAIMED');
  await relay.devices.confirm(proof, status.claimId, true);
}

async function stopRelay() {
  clearInterval(heartbeat);
  sockets.forEach((socket) => socket.terminate());
  await relay?.close();
  const pool = new Pool({ connectionString: url });

  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
}

export const test = base.extend<{ relayRuntime: undefined }>({
  relayRuntime: [
    async ({ browserName: _browserName }, use) => {
      await startRelay();

      try {
        await use(undefined);
      } finally {
        await stopRelay();
      }
    },
    { auto: true },
  ],
});
