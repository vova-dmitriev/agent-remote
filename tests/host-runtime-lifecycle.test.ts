import { expect, it, vi } from 'vitest';
import { ConnectionStatus } from '../packages/protocol/src/index.js';
import { AppTransport } from '../apps/mini-app/src/shared/api/transport.js';
import { TransportRuntime } from '../apps/mini-app/src/shared/lib/runtime/transport-runtime.js';
import { connectHost } from '../apps/mini-app/src/shared/lib/host/connection.js';
import { createSessionStore } from '../apps/mini-app/src/entities/session/model/store/create-session-store.js';
import type { HostAdapter } from '../apps/mini-app/src/shared/lib/host/types.js';

it('connects an injected host without Telegram and suppresses callbacks after replacement', async () => {
  const runtime = new TransportRuntime();
  const events: string[] = [];
  let publish!: () => void;

  const host: HostAdapter = {
    kind: 'chrome',
    capabilities: { pairDevice: false, revokeDevice: false, fullTab: true },
    createClient: (handlers) => {
      publish = () => handlers.onConnection(ConnectionStatus.Online);
      const client = new AppTransport('', handlers);

      client.start = async () => publish();

      return client;
    },
  };

  const close = connectHost(host, runtime, {
    onFrame: () => {},
    onConnection: (value) => events.push(value),
  });

  await Promise.resolve();
  expect(events).toEqual(['online']);
  const replacement = new AppTransport('', { onFrame: () => {}, onConnection: () => {} });
  const lease = runtime.attach(replacement);

  publish();
  close();
  expect(events).toEqual(['online']);
  expect(runtime.isCurrent(lease)).toBe(true);
  runtime.clear();
  replacement.close();
});

it('leaves startup loading on a denied native grant and exposes the terminal error', async () => {
  const runtime = new TransportRuntime();
  const connections: string[] = [];
  const codes: string[] = [];

  const host: HostAdapter = {
    kind: 'chrome',
    capabilities: { pairDevice: false, revokeDevice: false, fullTab: true },
    createClient: (handlers) => {
      const client = new AppTransport('', handlers);

      client.start = async () => {
        throw new Error('LOCAL_APPROVAL_REQUIRED');
      };

      return client;
    },
  };

  const close = connectHost(host, runtime, {
    onConnection: (value) => connections.push(value),
    onFrame: (frame) => {
      if (frame.type === 'error') {
        codes.push(frame.code);
      }
    },
  });

  await new Promise(setImmediate);
  expect(connections).toContain(ConnectionStatus.Expired);
  expect(codes).toEqual(['LOCAL_APPROVAL_REQUIRED']);
  close();
});

it.each([
  [401, ConnectionStatus.Expired, 'TELEGRAM_AUTH_FAILED'],
  [503, ConnectionStatus.Offline, 'SERVICE_UNAVAILABLE'],
])('retains startup classification and actionable feedback for HTTP %i', async (status, connection, code) => {
  const store = createSessionStore();
  const actions = store.getState();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));

  const host: HostAdapter = {
    kind: 'telegram',
    capabilities: { pairDevice: true, revokeDevice: true, fullTab: false },
    createClient: (handlers) => new AppTransport('synthetic-init', handlers, 'https://synthetic.invalid'),
  };

  const close = connectHost(host, actions.runtime, {
    onConnection: actions.setConnection,
    onFrame: actions.receiveFrame,
  });

  try {
    await new Promise(setImmediate);
    expect(store.getState().session.connection).toBe(connection);
    expect(store.getState().error).toBe(code);
    expect(store.getState().session.snapshot).toBeNull();
  } finally {
    close();
    vi.unstubAllGlobals();
  }
});
