import { afterEach, expect, it, vi } from 'vitest';
import { CommandActionType, ConnectionStatus, ErrorCode, LocalOperation, serverFrameSchema } from '@protocol';
import { ExtensionConnection } from '../apps/chrome-extension/src/client/connection.js';
import { ExtensionApplicationClient } from '../apps/chrome-extension/src/client/application-client.js';
import { createSessionStore } from '../apps/mini-app/src/entities/session/model/store/create-session-store.js';
import { reconnectFixture } from './extension-reconnect.fixture.js';
import { snapshotFrame } from './extension-client.fixture.js';

afterEach(() => vi.useRealTimers());

it('reconnects a live viewer using worker identity and cancels retries on close', async () => {
  const f = reconnectFixture();
  const connection = new ExtensionConnection(f.api);

  await connection.start();
  vi.useFakeTimers();
  f.hosts[0]!.close();
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.hosts).toHaveLength(2);
  expect(f.hellos[1]).toMatchObject({ clientId: f.hellos[0]!.clientId, handle: 'stable-handle' });
  expect(connection.grant?.lease).toBe('lease-1');
  f.hosts[1]!.close();
  connection.close();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(f.hosts).toHaveLength(2);
});

it('bounds unavailable companion retries and settles startup offline', async () => {
  const f = reconnectFixture();
  const connection = new ExtensionConnection(f.api);
  const states: ConnectionStatus[] = [];

  f.available(false);
  vi.useFakeTimers();
  connection.subscribeConnection((state) => states.push(state));
  const rejected = expect(connection.start()).rejects.toThrow(ErrorCode.LOCAL_HOST_UNAVAILABLE);

  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(f.hosts).toHaveLength(4);
  expect(states.at(-1)).toBe(ConnectionStatus.Offline);
  connection.close();
});

it('restores selected history after reconnect without replaying a lost send', async () => {
  const f = reconnectFixture();
  const connection = new ExtensionConnection(f.api);
  const client = new ExtensionApplicationClient(connection, { onFrame: () => {}, onConnection: () => {} });

  await client.start();
  client.selectTarget('device', 'a');

  await vi.waitFor(() =>
    expect(f.actions).toContainEqual({ operation: LocalOperation.Select, sessionId: 'a' }),
  );

  const session = serverFrameSchema.parse(snapshotFrame());

  if (!('snapshot' in session)) {
    throw new Error('snapshot missing');
  }

  f.dropSend();

  const command = {
    commandId: 'lost-send',
    target: session.snapshot.sessions[0]!.target,
    sessionId: 'a',
    generation: 'generation-a',
    action: { type: CommandActionType.Prompt, text: 'Send once' },
  };

  const sent = expect(client.send(command)).rejects.toThrow(ErrorCode.COMMAND_STATUS_UNKNOWN);

  await vi.waitFor(() =>
    expect(f.actions.some((action) => action.operation === LocalOperation.Send)).toBe(true),
  );

  vi.useFakeTimers();
  f.hosts[0]!.close();
  await sent;
  await vi.advanceTimersByTimeAsync(1000);

  await vi.waitFor(() =>
    expect(
      f.actions.some((action) => action.operation === LocalOperation.History && action.sessionId === 'a'),
    ).toBe(true),
  );

  await expect(client.checkPending('lost-send')).resolves.toMatchObject({
    commandId: 'lost-send',
    status: 'dispatched',
  });

  expect(f.actions.filter((action) => action.operation === LocalOperation.Send)).toHaveLength(1);
  client.close();
});

it('expires shared session data on a revoked result without reconnecting', async () => {
  const f = reconnectFixture();
  const store = createSessionStore();

  const client = new ExtensionApplicationClient(new ExtensionConnection(f.api), {
    onFrame: (frame) => store.getState().receiveFrame(frame),
    onConnection: (value) => store.getState().setConnection(value),
  });

  store.getState().runtime.attach(client);
  await client.start();
  await vi.waitFor(() => expect(store.getState().session.snapshot).not.toBeNull());
  vi.useFakeTimers();
  f.revoke();
  await expect(client.devices()).rejects.toThrow(ErrorCode.LOCAL_GRANT_REVOKED);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(store.getState().session.snapshot).toBeNull();
  expect(store.getState().session.connection).toBe(ConnectionStatus.Expired);
  expect(f.hosts).toHaveLength(1);
  client.close();
});

it.each([ErrorCode.LOCAL_VERSION_MISMATCH, ErrorCode.UNAUTHORIZED, ErrorCode.LOCAL_APPROVAL_REQUIRED])(
  'does not reconnect a terminal handshake failure: %s',
  async (code) => {
    const f = reconnectFixture();
    const connection = new ExtensionConnection(f.api);

    f.denyHello(code);
    vi.useFakeTimers();
    const started = connection.start().catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await started).toMatchObject({ message: code });
    expect(f.hosts).toHaveLength(1);
    connection.close();
  },
);
