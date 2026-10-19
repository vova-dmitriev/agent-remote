import { afterEach, it, expect, vi } from 'vitest';
import type { ServerFrame } from '@protocol';
import { AppTransport } from '../apps/mini-app/src/app/api/transport/app-transport.js';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen: () => void = () => {};
  onmessage: (event: { data: string }) => void = () => {};
  onclose: (event: { code: number }) => void = () => {};
  onerror: () => void = () => {};
  constructor(_url: unknown) {
    Socket.instances.push(this);
  }
  send(_value: string) {}
  close() {}
  frame(value: unknown) {
    this.onmessage({ data: JSON.stringify(value) });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Socket.instances = [];
});

it('reloads one selected history page after reconnect and fetches older pages only on demand', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  let history = 0;
  const calls: ServerFrame[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path.endsWith('/auth/telegram')) {
        return Response.json({ token: 'token', expiresAt: Date.now() + 900000 });
      }

      if (path.includes('/events')) {
        history++;

        return Response.json(
          [
            {
              version: 1,
              deviceId: 'd',
              streamId: 's',
              seq: history,
              eventId: 'e' + history,
              sessionId: 'selected',
              occurredAt: 1,
              type: 'message',
              payload: { id: 'm' + history, role: 'assistant', text: 'restored', occurredAt: 1 },
            },
          ],
          { headers: history % 2 === 1 ? { 'X-Next-Cursor': 'next' } : {} },
        );
      }

      throw new Error('unexpected request');
    }),
  );

  const transport = new AppTransport('init', {
    onFrame: (frame) => calls.push(frame),
    onConnection: () => {},
  });

  await transport.start();
  transport.selectTarget('d', 'selected');

  const snapshot = {
    type: 'snapshot',
    deviceId: 'd',
    connectors: [],
    snapshot: {
      sessions: [],
      deviceStatus: 'online',
      cursor: { streamId: 's', seq: 0 },
      permissions: [],
      terminal: null,
    },
  };

  Socket.instances[0]!.frame({ type: 'authenticated' });
  Socket.instances[0]!.frame(snapshot);
  await vi.advanceTimersByTimeAsync(0);
  expect(history).toBe(1);
  const older = await transport.historyPage('selected', 'before');

  expect(older).toHaveLength(1);
  expect(history).toBe(2);
  Socket.instances[0]!.onclose({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1500);
  Socket.instances[1]!.frame({ type: 'authenticated' });
  Socket.instances[1]!.frame(snapshot);
  await vi.advanceTimersByTimeAsync(0);
  expect(history).toBe(3);
  expect(calls.filter((f) => f.type === 'event')).toHaveLength(2);
  transport.close();
});
