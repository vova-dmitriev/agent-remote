import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopIpcClient } from '@daemon/codex/desktop/desktop-ipc.js';
import { RuntimeEvent } from '@daemon/domain/runtime.js';

const FRAME_CAP = 32 * 1024 * 1024;

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  vi.restoreAllMocks();

  for (const close of cleanups.splice(0).reverse()) {
    await close();
  }
});

async function fixture(options: { oversizedMethod?: string; steerTurnId?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-ipc-'));

  await chmod(dir, 0o700);

  const path = join(dir, 'ipc.sock'),
    frames: Record<string, unknown>[] = [];

  let peer: Socket;

  const send = (frame: unknown) => {
    const json = Buffer.from(JSON.stringify(frame));
    const header = Buffer.alloc(4);

    header.writeUInt32LE(json.length);
    peer.write(Buffer.concat([header, json]));
  };

  // Writes header and body separately so the fixture itself never concatenates the large payload.
  const oversize = (prefix: string, suffix: string) => {
    const body = Buffer.alloc(FRAME_CAP + 4096, 'x');

    body.write(prefix, 0);
    body.write(suffix, body.length - Buffer.byteLength(suffix));
    const header = Buffer.alloc(4);

    header.writeUInt32LE(body.length);
    peer.write(header);
    peer.write(body);
  };

  const server = createServer((socket) => {
    peer = socket;
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const length = buffer.readUInt32LE(0);
        const frame = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));

        buffer = buffer.subarray(4 + length);
        frames.push(frame);

        if (frame.type === 'request' && frame.method === options.oversizedMethod) {
          oversize(
            `{"type":"response","requestId":${JSON.stringify(frame.requestId)},"resultType":"success","result":{"blob":"`,
            '"}}',
          );
        } else if (frame.type === 'request') {
          let result: unknown = { ok: true };

          if (frame.method === 'initialize') {
            result = { clientId: 'remote-client' };
          } else if (frame.method === 'thread-follower-steer-turn' && options.steerTurnId) {
            result = { turnId: options.steerTurnId };
          }

          send({
            type: 'response',
            requestId: frame.requestId,
            method: frame.method,
            handledByClientId: 'owner',
            resultType: 'success',
            result,
          });
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(path, resolve));
  await chmod(path, 0o600);

  cleanups.push(async () => {
    peer?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  const client = await DesktopIpcClient.connect(path);

  cleanups.push(() => client.close());

  return { client, frames, send, oversize, raw: (bytes: Buffer) => peer.write(bytes) };
}

it('uses framed private IPC and an exact desktop owner for discovery/commands', async () => {
  const f = await fixture();

  expect(await f.client.owner('thread')).toBe('owner');

  expect(f.frames[0]).toMatchObject({
    method: 'initialize',
    version: 0,
    params: { clientType: 'claude-remote' },
  });

  await f.client.request(
    'thread-follower-interrupt-turn',
    { conversationId: 'thread', expectedTurnId: 'turn', mode: 'user-stop' },
    'owner',
  );

  expect(f.frames.at(-1)).toMatchObject({
    sourceClientId: 'remote-client',
    targetClientId: 'owner',
    version: 4,
    method: 'thread-follower-interrupt-turn',
  });
});

it('round-trips a Send now steer to the exact owner over the controlled desktop socket', async () => {
  const f = await fixture({ steerTurnId: 'busy-turn' });

  expect(await f.client.owner('thread')).toBe('owner');

  await expect(
    f.client.request(
      'thread-follower-steer-turn',
      {
        conversationId: 'thread',
        expectedTurnId: 'busy-turn',
        input: [{ type: 'text', text: 'synthetic immediate prompt' }],
        restoreMessage: {
          text: 'synthetic immediate prompt',
          context: { prompt: 'synthetic immediate prompt' },
        },
      },
      'owner',
    ),
  ).resolves.toEqual({ turnId: 'busy-turn' });

  expect(f.frames.at(-1)).toMatchObject({
    sourceClientId: 'remote-client',
    targetClientId: 'owner',
    method: 'thread-follower-steer-turn',
    params: { conversationId: 'thread', expectedTurnId: 'busy-turn' },
  });
});

it('routes broadcasts and still disconnects on a zero-length frame', async () => {
  const f = await fixture();
  const broadcasts: unknown[] = [];

  f.client.on('broadcast', (frame) => broadcasts.push(frame));

  f.send({
    type: 'broadcast',
    method: 'thread-stream-state-changed',
    version: 11,
    sourceClientId: 'owner',
    params: { conversationId: 'thread' },
  });

  await expect.poll(() => broadcasts.length).toBe(1);
  const closed = new Promise<void>((resolve) => f.client.once('disconnected', resolve));

  f.raw(Buffer.alloc(4));
  await closed;
  await expect(f.client.request('after-close', {}, 'owner')).rejects.toThrow('CODEX_DISCONNECTED');
});

it('drains an oversize thread snapshot without buffering it and fails only that thread', async () => {
  const f = await fixture();
  const broadcasts: Record<string, unknown>[] = [];
  const oversized: unknown[] = [];
  let disconnected = false;
  let largestConcat = 0;
  const concat = Buffer.concat.bind(Buffer);

  f.client.on(RuntimeEvent.Broadcast, (frame) => broadcasts.push(frame));
  f.client.on(RuntimeEvent.FrameTooLarge, (route) => oversized.push(route));
  f.client.on(RuntimeEvent.Disconnected, () => (disconnected = true));

  vi.spyOn(Buffer, 'concat').mockImplementation((list, length) => {
    const result = concat(list, length);

    largestConcat = Math.max(largestConcat, result.length);

    return result;
  });

  // The routing id follows the payload and a nested decoy id must not be mistaken for it.
  f.oversize(
    '{"type":"broadcast","method":"thread-stream-state-changed","version":11,"sourceClientId":"owner",' +
      '"params":{"hostId":"local","change":{"type":"snapshot","conversationState":{"conversationId":"small","blob":"',
    '"}},"conversationId":"big"}}',
  );

  f.send({
    type: 'broadcast',
    method: 'thread-stream-state-changed',
    version: 11,
    sourceClientId: 'owner',
    params: { conversationId: 'small' },
  });

  await expect.poll(() => broadcasts.length, { timeout: 5000 }).toBe(1);
  expect(broadcasts[0]).toMatchObject({ params: { conversationId: 'small' } });
  expect(oversized).toEqual([{ conversationId: 'big', sourceClientId: 'owner' }]);
  expect(f.client.frameTooLarge('big', 'owner')).toBe(true);
  expect(f.client.frameTooLarge('small', 'owner')).toBe(false);
  expect(largestConcat).toBeLessThan(1024 * 1024);
  expect(disconnected).toBe(false);
  expect(await f.client.owner('small')).toBe('owner');
}, 20_000);

it('rejects only the request whose response exceeds the frame cap', async () => {
  const f = await fixture({ oversizedMethod: 'thread-follower-load-complete-history' });
  let disconnected = false;

  f.client.on(RuntimeEvent.Disconnected, () => (disconnected = true));

  const [large, small] = await Promise.allSettled([
    f.client.request('thread-follower-load-complete-history', { conversationId: 'big' }, 'owner'),
    f.client.request('thread-follower-read-model-settings', { conversationId: 'small' }, 'owner'),
  ]);

  expect(large).toMatchObject({ status: 'rejected', reason: { code: 'CODEX_FRAME_TOO_LARGE' } });
  expect(small).toMatchObject({ status: 'fulfilled', value: { ok: true } });
  expect(disconnected).toBe(false);
  expect(await f.client.owner('small')).toBe('owner');
}, 20_000);
