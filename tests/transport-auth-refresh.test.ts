import { afterEach, expect, it, vi } from 'vitest';
import { HttpStatus } from '@protocol';
import { AppTransport } from '../apps/mini-app/src/shared/api/transport.js';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen = () => {};
  onmessage: (event: { data: string }) => void = () => {};
  onclose: (event: { code: number }) => void = () => {};
  onerror = () => {};
  constructor(_url: unknown) {
    Socket.instances.push(this);
  }
  send(_value: string) {}
  close() {}
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Socket.instances = [];
});

it('reloads with stale Telegram initData using its cookie and renews access without clearing selection', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  let refreshes = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path.endsWith('/auth/telegram')) {
        return Response.json({ code: 'UNAUTHORIZED' }, { status: HttpStatus.Unauthorized });
      }

      if (path.endsWith('/auth/refresh')) {
        refreshes++;

        return Response.json({ token: 'token-' + refreshes, expiresAt: Date.now() + 900000 });
      }

      throw new Error('Unexpected request');
    }),
  );

  const states: string[] = [];
  const client = new AppTransport('stale', { onFrame() {}, onConnection: (state) => states.push(state) });

  try {
    await client.start();
    expect(refreshes).toBe(1);
    client.selectTarget('device', 'selected');
    await vi.advanceTimersByTimeAsync(840000);
    expect(refreshes).toBe(2);
    expect(Socket.instances).toHaveLength(2);
    expect(states).not.toContain('expired');
  } finally {
    client.close();
  }
});
