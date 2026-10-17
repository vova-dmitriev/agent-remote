import { expect } from '@playwright/test';
import { WebSocket } from 'ws';
import type { AppSnapshot, ConnectorDescriptor } from '../../../packages/protocol/src/index.js';
import { delivered, deviceFixture } from '../support/relay-fixture.js';

export async function currentSnapshot(): Promise<AppSnapshot> {
  const { relay, deviceId } = deviceFixture();
  const result = await relay.db.pool.query('SELECT snapshot FROM devices WHERE id=$1', [deviceId]);

  return result.rows[0].snapshot as AppSnapshot;
}

export async function publishSnapshot(
  mutate: (snapshot: AppSnapshot) => void,
  connectors: ConnectorDescriptor[] = [],
) {
  const { relay, sockets, deviceId } = deviceFixture();
  const snapshot = await currentSnapshot();

  mutate(snapshot);
  sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors }));

  await expect
    .poll(async () => {
      const result = await relay.db.pool.query('SELECT snapshot FROM devices WHERE id=$1', [deviceId]);

      return result.rows[0].snapshot;
    })
    .toEqual(snapshot);
}

export async function dropDevice() {
  const { sockets } = deviceFixture();
  const closed = new Promise<void>((resolve) => sockets[0]!.once('close', () => resolve()));

  sockets[0]!.terminate();
  await closed;
}

export async function restoreDevice() {
  const { sockets, deviceToken } = deviceFixture();
  const socket = new WebSocket('ws://127.0.0.1:3000/ws/device');

  sockets[0] = socket;

  await new Promise<void>((resolve, reject) => {
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: deviceToken })));
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

  await publishSnapshot((snapshot) => {
    snapshot.deviceStatus = 'online';
  });
}
