import { expect, it } from 'vitest';
import { HttpStatus, ErrorCode } from '@protocol';
import type { WebSocket } from 'ws';
import { ProfileProxy } from '../apps/server/src/profiles/transport/proxy.js';
import { Fault } from '../apps/server/src/http/errors/fault.js';
import type { ServerFrame } from '@protocol';

function fixture() {
  const connection = {
    socket: {} as WebSocket,
    epoch: 'epoch-a',
    device: { id: 'mac-a', owner_id: 'owner-a', generation: 'generation-a' },
  };

  const live = new Map([['mac-a', connection]]);
  const sent: ServerFrame[] = [];
  let emitted!: () => void;

  const dispatched = new Promise<void>((resolve) => {
    emitted = resolve;
  });

  let authorized = true;

  const authorize = async () => {
    if (!authorized) {
      throw new Fault(ErrorCode.UNAUTHORIZED, HttpStatus.Unauthorized);
    }
  };

  const devices = {
    owned: async (principal: { userId: string }, deviceId: string) => {
      if (principal.userId !== 'owner-a' || deviceId !== 'mac-a') {
        throw new Fault(ErrorCode.NOT_FOUND, HttpStatus.NotFound);
      }

      return { ...connection.device, revoked_at: null, last_seen_at: '', snapshot: null, connectors: [] };
    },
  };

  const proxy = new ProfileProxy(devices, live, (_socket, frame) => {
    sent.push(frame);
    emitted();

    return true;
  });

  const start = () =>
    proxy.request(
      { userId: 'owner-a', telegramId: 'synthetic' },
      'mac-a',
      { kind: 'list' },
      'synthetic-auth-hash',
      authorize,
    );

  const result = (request: Extract<ServerFrame, { type: 'profiles_request' }>) => ({
    type: 'profiles_result' as const,
    requestId: request.requestId,
    epoch: request.epoch,
    reply: {
      ok: true as const,
      response: {
        kind: 'list' as const,
        data: {
          available: true,
          observedAt: 0,
          profiles: [],
          operations: [],
          defaults: { claude: null, codex: null },
        },
      },
    },
  });

  return {
    proxy,
    live,
    connection,
    sent,
    dispatched,
    start,
    result,
    revoke: () => {
      authorized = false;
    },
  };
}

it('checks owner/device before dispatch and rejects foreign access', async () => {
  const f = fixture();

  await expect(
    f.proxy.request(
      { userId: 'foreign', telegramId: 'synthetic' },
      'mac-a',
      { kind: 'list' },
      'hash',
      async () => {},
    ),
  ).rejects.toThrow(/^NOT_FOUND$/);

  expect(f.sent).toEqual([]);
  f.proxy.close();
});

it('accepts only the matching live epoch and requested response kind', async () => {
  const f = fixture();
  const pending = f.start();

  await f.dispatched;
  const request = f.sent[0] as Extract<ServerFrame, { type: 'profiles_request' }>;

  await f.proxy.accept(f.connection, { ...f.result(request), epoch: 'old' });
  await f.proxy.accept(f.connection, f.result(request));
  expect((await pending).kind).toBe('list');
  f.proxy.close();
});

it('cancels an in-flight native request on logout instead of waiting for its eventual write', async () => {
  const f = fixture();
  const pending = f.start();
  const rejected = expect(pending).rejects.toThrow(/^UNAUTHORIZED$/);

  await f.dispatched;
  f.proxy.cancelAuth(['synthetic-auth-hash']);
  await rejected;
  expect(f.sent[1]).toMatchObject({ type: 'profiles_cancel', epoch: 'epoch-a' });
  f.proxy.close();
});

it('rechecks caller authorization after native work before returning metadata', async () => {
  const f = fixture();
  const pending = f.start();
  const rejected = expect(pending).rejects.toThrow(/^UNAUTHORIZED$/);

  await f.dispatched;
  f.revoke();

  await f.proxy.accept(
    f.connection,
    f.result(f.sent[0] as Extract<ServerFrame, { type: 'profiles_request' }>),
  );

  await rejected;
  f.proxy.close();
});

it('rejects outstanding requests immediately when their device connection disappears', async () => {
  const f = fixture();
  const pending = f.start();
  const rejected = expect(pending).rejects.toThrow(/^DEVICE_OFFLINE$/);

  try {
    await f.dispatched;
    expect(typeof f.proxy.disconnect).toBe('function');
    f.proxy.disconnect(f.connection);
    await rejected;
  } finally {
    f.proxy.close();
    await rejected;
  }
});
