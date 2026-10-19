import { afterEach, expect, it, vi } from 'vitest';
import { AppTransport } from '../apps/mini-app/src/shared/api/transport.js';
import type { ServerFrame } from '@protocol';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen = () => {};
  onerror = () => {};
  onmessage = (_event: { data: string }) => {};
  onclose = (_event: { code: number }) => {};
  constructor(_url: unknown) {
    Socket.instances.push(this);
  }
  send(_value: string) {}
  close() {}
  frame(value: unknown) {
    this.onmessage({ data: JSON.stringify(value) });
  }
}

const snapshot = {
  type: 'snapshot',
  deviceId: 'device',
  connectors: [],
  snapshot: {
    sessions: [],
    deviceStatus: 'online',
    cursor: { streamId: 'stream', seq: 0 },
    permissions: [],
    terminal: null,
  },
};

const clients: AppTransport[] = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Socket.instances = [];
});

async function fixture() {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  const pending: { resolve: (response: Response) => void; reject: (reason: Error) => void }[] = [];
  const frames: ServerFrame[] = [];
  const statuses: { id: string; status: string }[] = [];

  vi.stubGlobal('fetch', (url: string) => {
    if (url.endsWith('/reading-position')) {
      return Promise.resolve(Response.json({ position: null }));
    }

    if (url.endsWith('/auth/telegram')) {
      return Promise.resolve(Response.json({ token: 'synthetic', expiresAt: Date.now() + 900000 }));
    }

    return new Promise<Response>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  });

  const transport = new AppTransport(
    'synthetic',
    {
      onFrame: (frame) => frames.push(frame),
      onConnection: () => {},
      onHistoryStatus: (id, status) => statuses.push({ id, status }),
    },
    'https://synthetic.invalid',
  );

  clients.push(transport);
  await transport.start();
  const socket = Socket.instances[0]!;

  socket.frame({ type: 'authenticated' });
  socket.frame(snapshot);
  await vi.advanceTimersByTimeAsync(0);

  async function reconnect() {
    Socket.instances.at(-1)!.onclose({ code: 1006 });
    await vi.advanceTimersByTimeAsync(1500);
    const next = Socket.instances.at(-1)!;

    next.frame({ type: 'authenticated' });
    next.frame(snapshot);
    await vi.advanceTimersByTimeAsync(0);

    return next;
  }

  return { transport, socket, pending, frames, statuses, reconnect };
}

it('does not schedule a duplicate background history load on the first selected-session snapshot', async () => {
  const { transport, socket, pending, statuses } = await fixture();

  transport.selectTarget('device', 'first');
  const history = transport.history('first');

  await vi.advanceTimersByTimeAsync(0);

  socket.frame(snapshot);
  await vi.advanceTimersByTimeAsync(0);
  expect(pending).toHaveLength(1);
  expect(statuses).toEqual([{ id: 'first', status: 'loading' }]);
  pending[0]!.resolve(Response.json([]));
  await history;
  expect(statuses.at(-1)).toEqual({ id: 'first', status: 'ready' });
});

it.each(['different', 'same', 'closed', 'new-socket'])(
  'ignores a reconnect failure after %s selection invalidation',
  async (kind) => {
    const { transport, pending, frames, statuses, reconnect } = await fixture();

    transport.selectTarget('device', 'first');
    await reconnect();
    expect(pending).toHaveLength(1);
    expect(statuses.at(-1)).toEqual({ id: 'first', status: 'loading' });

    if (kind === 'closed') {
      transport.close();
    } else if (kind === 'new-socket') {
      await reconnect();
    } else {
      transport.selectTarget('device', kind === 'same' ? 'first' : 'second');
    }

    const statusCount = statuses.length;

    pending[0]!.reject(new TypeError('Synthetic old request failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(frames.filter((frame) => frame.type === 'error')).toEqual([]);
    expect(statuses).toHaveLength(statusCount);

    if (kind === 'new-socket') {
      pending[1]!.resolve(Response.json([]));
      await vi.advanceTimersByTimeAsync(0);
    }
  },
);

it('reports loading before a reconnect reload settles, then reports its genuine failure', async () => {
  const { transport, pending, frames, statuses, reconnect } = await fixture();

  transport.selectTarget('device', 'first');
  await reconnect();
  expect(statuses).toEqual([{ id: 'first', status: 'loading' }]);
  expect(frames.filter((frame) => frame.type === 'error')).toEqual([]);
  pending[0]!.reject(new TypeError('Synthetic current request failure'));
  await vi.advanceTimersByTimeAsync(0);
  expect(statuses.at(-1)).toEqual({ id: 'first', status: 'error' });
  expect(frames.at(-1)).toEqual({ type: 'error', code: 'HISTORY_RELOAD_FAILED' });
});

it.each(['success', 'failure'])(
  'discards an obsolete manual history %s after reconnect restoration completes',
  async (outcome) => {
    const { transport, pending, frames, statuses, reconnect } = await fixture();

    transport.selectTarget('device', 'first');
    const manual = transport.history('first');

    await vi.advanceTimersByTimeAsync(0);

    await reconnect();
    pending[1]!.resolve(Response.json([]));
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toEqual({ id: 'first', status: 'ready' });

    if (outcome === 'success') {
      pending[0]!.resolve(Response.json([{ type: 'message', payload: { text: 'obsolete' } }]));
    } else {
      pending[0]!.reject(new TypeError('Obsolete manual failure'));
    }

    expect(await manual).toBeNull();
    expect(statuses.at(-1)).toEqual({ id: 'first', status: 'ready' });
    expect(frames.filter((frame) => frame.type === 'error')).toEqual([]);
  },
);

it('restores selected history after a live snapshot changes stream without reconnecting', async () => {
  const { transport, socket, pending, statuses } = await fixture();

  transport.selectTarget('device', 'first');

  socket.frame({
    ...snapshot,
    snapshot: { ...snapshot.snapshot, cursor: { streamId: 'next-stream', seq: 0 } },
  });

  await vi.advanceTimersByTimeAsync(0);
  expect(pending).toHaveLength(1);
  expect(statuses.at(-1)).toEqual({ id: 'first', status: 'loading' });
  pending[0]!.resolve(Response.json([]));
  await vi.advanceTimersByTimeAsync(0);
  expect(statuses.at(-1)).toEqual({ id: 'first', status: 'ready' });
});

it.each(['network', 'forbidden'])(
  'contextualizes manual %s failure without hiding authorization errors',
  async (kind) => {
    const { transport, pending, statuses } = await fixture();

    transport.selectTarget('device', 'first');
    const history = transport.history('first');

    await vi.advanceTimersByTimeAsync(0);

    if (kind === 'network') {
      pending[0]!.reject(new TypeError('Synthetic network failure'));
    } else {
      pending[0]!.resolve(new Response('', { status: 403 }));
    }

    await expect(history).rejects.toThrow(kind === 'network' ? 'HISTORY_RELOAD_FAILED' : 'ACCESS_DENIED');
    expect(statuses.at(-1)).toEqual({ id: 'first', status: 'error' });
  },
);

it('discards manual history from the previous stream when a live snapshot resets it', async () => {
  const { transport, socket, pending, statuses } = await fixture();

  transport.selectTarget('device', 'first');
  const obsolete = transport.history('first');

  await vi.advanceTimersByTimeAsync(0);

  socket.frame({
    ...snapshot,
    snapshot: { ...snapshot.snapshot, cursor: { streamId: 'next-stream', seq: 0 } },
  });

  await vi.advanceTimersByTimeAsync(0);
  pending[1]!.resolve(Response.json([]));
  await vi.advanceTimersByTimeAsync(0);
  pending[0]!.reject(new TypeError('Previous stream manual failure'));
  expect(await obsolete).toBeNull();
  expect(statuses.at(-1)).toEqual({ id: 'first', status: 'ready' });
});
