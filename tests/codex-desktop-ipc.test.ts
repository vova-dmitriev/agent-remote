import { afterEach, expect, it } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopIpcClient } from '../apps/daemon/src/codex/desktop-ipc.js';

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) {
    await close();
  }
});

async function fixture() {
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

        if (frame.type === 'request') {
          send({
            type: 'response',
            requestId: frame.requestId,
            method: frame.method,
            handledByClientId: 'owner',
            resultType: 'success',
            result: frame.method === 'initialize' ? { clientId: 'remote-client' } : { ok: true },
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

  return { client, frames, send, raw: (bytes: Buffer) => peer.write(bytes) };
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

it('routes broadcasts and rejects an oversized length without allocating its payload', async () => {
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
  const header = Buffer.alloc(4);

  header.writeUInt32LE(32 * 1024 * 1024 + 1);
  f.raw(header);
  await closed;
  await expect(f.client.request('after-close', {}, 'owner')).rejects.toThrow('CODEX_DISCONNECTED');
});
