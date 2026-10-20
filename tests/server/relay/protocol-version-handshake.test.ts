import {
  ErrorCode,
  FrameType,
  RELAY_PROTOCOL,
  SocketCloseCode,
  SocketCloseReason,
  type ServerFrame,
} from '@protocol';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { RelayClient } from '../../../apps/daemon/src/relay-client.js';
import { RuntimeEvent } from '../../../apps/daemon/src/domain/runtime.js';
import { PROTOCOL_REPROBE_MS } from '../../../apps/daemon/src/runtime-timings.js';
import { attachmentRelayFixture } from '../../helpers/attachment-relay.js';

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

it('probes again only after the long interval once the relay rejects the protocol version, and surfaces the code', async () => {
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

  // Only the client's retry timers are fake; sockets run on real I/O.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  cleanups.push(() => vi.useRealTimers());

  const client = new RelayClient(`http://127.0.0.1:${port}`, 'synthetic-device-token');

  const auth = {
    type: FrameType.Auth,
    token: 'synthetic-device-token',
    protocolVersion: RELAY_PROTOCOL.Current,
  };

  cleanups.push(() => client.close());
  client.connect();

  expect(await once(client, RuntimeEvent.ProtocolUnsupported)).toEqual([ErrorCode.PROTOCOL_UNSUPPORTED]);

  // The ordinary reconnect would come within 30 s; none does before the re-probe interval ends.
  await vi.advanceTimersByTimeAsync(PROTOCOL_REPROBE_MS - 1);
  expect(auths).toEqual([auth]);

  await vi.advanceTimersByTimeAsync(1);
  await expect.poll(() => auths.length).toBe(2);
  expect(auths).toEqual([auth, auth]);
});

it.each([0, 1.5, '2'])(
  'rejects malformed protocol version %j as an invalid request before authentication',
  async (version) => {
    const f = await relay();
    const device = await authenticateDevice(f.origin, { token: f.deviceToken, protocolVersion: version });

    expect(await device.closed).toEqual({
      code: SocketCloseCode.Unauthorized,
      reason: SocketCloseReason.Unauthorized,
    });

    expect(device.frames).toEqual([{ type: FrameType.Error, code: ErrorCode.INVALID_REQUEST }]);
  },
);

it('authenticates an Auth frame that carries a field this relay does not know', async () => {
  const f = await relay();

  const device = await authenticateDevice(f.origin, {
    token: f.deviceToken,
    protocolVersion: RELAY_PROTOCOL.Current,
    futureField: { anything: true },
  });

  expect(await firstFrame(device.frames)).toMatchObject({
    type: FrameType.Authenticated,
    protocolVersion: RELAY_PROTOCOL.Current,
  });
});
