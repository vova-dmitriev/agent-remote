import { FrameType, SocketCloseCode } from '@protocol';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { RelayClient } from '../../apps/daemon/src/relay-client.js';
import { RuntimeEvent } from '../../apps/daemon/src/domain/runtime.js';
import { RELAY_RECONNECT_BACKOFF } from '../../apps/daemon/src/runtime-timings.js';

const cleanups: Array<() => Promise<unknown> | unknown> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }

  vi.restoreAllMocks();
});

it('keeps backing off when a relay authenticates the companion and drops it at once', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });

  cleanups.push(() => new Promise((resolve) => server.close(resolve)));

  server.on('connection', (socket) =>
    socket.on('message', () => {
      socket.send(JSON.stringify({ type: FrameType.Authenticated }));
      socket.close(SocketCloseCode.TryAgainLater);
    }),
  );

  await once(server, 'listening');
  const { port } = server.address() as { port: number };

  // Only the client's retry timers are fake; sockets run on real I/O. The top of the jitter range makes each delay
  // one millisecond short of the ceiling.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  cleanups.push(() => vi.useRealTimers());
  vi.spyOn(Math, 'random').mockReturnValue(0.999_999);

  const client = new RelayClient(`http://127.0.0.1:${port}`, 'synthetic-device-token');
  const connect = vi.spyOn(client, 'connect');
  let online = 0;

  client.on(RuntimeEvent.Online, () => ++online);
  cleanups.push(() => client.close());
  client.connect();

  for (const ceiling of [1, 2, 4, 8].map((factor) => RELAY_RECONNECT_BACKOFF.BaseMs * factor)) {
    await once(client, RuntimeEvent.Offline);
    const attempts = connect.mock.calls.length;

    await vi.advanceTimersByTimeAsync(ceiling - 2);
    expect(connect).toHaveBeenCalledTimes(attempts);

    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(attempts + 1);
  }

  // Every connection did authenticate before the relay dropped it.
  expect(online).toBe(4);
});
