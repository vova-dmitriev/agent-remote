import { test as base, expect } from '@playwright/test';
import { Pool } from 'pg';
import { WebSocket } from 'ws';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { initData } from '../../helpers/telegram.js';
import type { ClientCommand, HistoryMessage } from '@protocol';
import { sessionSnapshot } from './session-fixtures.js';
import { commandOutcome, setCommandOutcome } from '../runtime/command-outcome.js';
import { appOrigin, relaySocketOrigin, relayPort } from '../runtime/app-origin.js';
import { startRelayProcess, type RemoteRelay } from './relay-process.js';

export { setCommandOutcome } from '../runtime/command-outcome.js';

const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test',
  schema = 'e2e_' + randomUUID().replaceAll('-', '');

let relay: RemoteRelay;
const sockets: WebSocket[] = [];
// The relay's epoch for each authenticated device socket, as its `authenticated` frame reported it.
const epochs = new WeakMap<WebSocket, string>();

export const rememberEpoch = (socket: WebSocket, epoch: string) => epochs.set(socket, epoch);

/** The epoch of the current device connection, or undefined when its socket is not open (the device is offline). */
export const liveEpoch = () =>
  sockets[0]?.readyState === WebSocket.OPEN ? epochs.get(sockets[0]) : undefined;

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

  relay = await startRelayProcess({
    databaseUrl: url,
    schema,
    publicOrigin: appOrigin,
    port: relayPort,
    inputEnabled: true,
    permissionsEnabled: true,
  });

  const login = await relay.auth.login(initData('801'));

  const code = randomBytes(16).toString('hex'),
    proof = randomBytes(32).toString('hex');

  await relay.devices.start(sha(code), sha(proof));
  const claim = await relay.devices.claim(await relay.auth.authenticate(login.token), code);
  const device = (await relay.devices.confirm(proof, claim.claimId, true))!;

  deviceId = device.deviceId;
  deviceToken = device.token;
  const ws = new WebSocket(`${relaySocketOrigin}/ws/device`);

  sockets.push(ws);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: device.token })));
    ws.on('error', reject);

    ws.on('message', (raw) => {
      const frame = JSON.parse(String(raw));

      if (frame.type === 'authenticated') {
        rememberEpoch(ws, frame.epoch);
        resolve();
      }

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

  await relay.notifications.updates([
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
      try {
        await startRelay();
        await use(undefined);
      } finally {
        await stopRelay();
      }
    },
    { auto: true },
  ],
});
