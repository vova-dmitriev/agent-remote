import {
  ErrorCode,
  FrameType,
  RELAY_PROTOCOL,
  SocketCloseCode,
  SocketCloseReason,
  type ServerFrame,
} from '@protocol';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { RelayClient } from '../apps/daemon/src/relay-client.js';
import { RuntimeEvent } from '../apps/daemon/src/domain/runtime.js';
import { attachmentRelayFixture } from './helpers/attachment-relay.js';

const cleanups: Array<() => Promise<unknown> | unknown> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function relay() {
  const f = await attachmentRelayFixture();

  cleanups.push(() => f.close());

  return f;
}

/** A raw device socket that sends one auth frame and records what the relay answers until it closes. */
async function authenticateDevice(origin: string, auth: Record<string, unknown>) {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws/device');
  const frames: ServerFrame[] = [];

  cleanups.push(() => socket.terminate());
  socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as ServerFrame));
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: FrameType.Auth, ...auth }));

  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
  );

  return { socket, frames, closed };
}

const firstFrame = async (frames: ServerFrame[]) => {
  await expect.poll(() => frames.length).toBeGreaterThan(0);

  return frames[0]!;
};

it('authenticates a daemon that sends no version and answers without one', async () => {
  const f = await relay();
  const device = await authenticateDevice(f.origin, { token: f.deviceToken });
  const frame = await firstFrame(device.frames);

  // An old daemon parses `Authenticated` strictly: any extra field would make it drop the connection.
  expect(Object.keys(frame).sort()).toEqual(['epoch', 'type']);
  expect(frame.type).toBe(FrameType.Authenticated);
});

it('answers a current daemon with the negotiated version', async () => {
  const f = await relay();

  const device = await authenticateDevice(f.origin, {
    token: f.deviceToken,
    protocolVersion: RELAY_PROTOCOL.Current,
  });

  expect(await firstFrame(device.frames)).toMatchObject({
    type: FrameType.Authenticated,
    protocolVersion: RELAY_PROTOCOL.Current,
  });
});

it.each([99, RELAY_PROTOCOL.Current + 1])(
  'rejects protocol version %i with PROTOCOL_UNSUPPORTED and close 4004',
  async (version) => {
    const f = await relay();
    const device = await authenticateDevice(f.origin, { token: f.deviceToken, protocolVersion: version });

    expect(await device.closed).toEqual({
      code: SocketCloseCode.ProtocolUnsupported,
      reason: SocketCloseReason.ProtocolUnsupported,
    });

    expect(device.frames).toEqual([{ type: FrameType.Error, code: ErrorCode.PROTOCOL_UNSUPPORTED }]);
    expect(f.relay.live.has(f.deviceId)).toBe(false);
  },
);

it('connects the daemon relay client with the current version', async () => {
  const f = await relay();
  const client = new RelayClient(f.origin, f.deviceToken);

  cleanups.push(() => client.close());
  client.connect();
  await once(client, RuntimeEvent.Online);

  expect(f.relay.live.get(f.deviceId)?.protocolVersion).toBe(RELAY_PROTOCOL.Current);
});

it('stops the daemon relay client from reconnecting after PROTOCOL_UNSUPPORTED and surfaces the code', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const auths: unknown[] = [];

  cleanups.push(() => new Promise((resolve) => server.close(resolve)));

  server.on('connection', (socket) =>
    socket.on('message', (raw) => {
      auths.push(JSON.parse(String(raw)));
      socket.send(JSON.stringify({ type: FrameType.Error, code: ErrorCode.PROTOCOL_UNSUPPORTED }));
      socket.close(SocketCloseCode.ProtocolUnsupported, SocketCloseReason.ProtocolUnsupported);
    }),
  );

  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  const client = new RelayClient(`http://127.0.0.1:${port}`, 'synthetic-device-token');

  cleanups.push(() => client.close());
  client.connect();

  expect(await once(client, RuntimeEvent.ProtocolUnsupported)).toEqual([ErrorCode.PROTOCOL_UNSUPPORTED]);
  // Longer than the first reconnect delay (at most 1 s): no second attempt follows.
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  expect(auths).toEqual([
    { type: FrameType.Auth, token: 'synthetic-device-token', protocolVersion: RELAY_PROTOCOL.Current },
  ]);
});
