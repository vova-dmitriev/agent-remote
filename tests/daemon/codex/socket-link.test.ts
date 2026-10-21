import { afterEach, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { ErrorCode } from '@protocol';
import { verifyLocalSocket } from '@daemon/codex/rpc/transport.js';

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function listen(path: string) {
  const server: Server = createServer();

  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
}

async function directory() {
  const root = await mkdtemp('/tmp/ar-link-');

  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);

  return root;
}

// Codex 0.163 listens in a private directory under /tmp and links the requested path to it.
it('follows a socket link to a private socket of this user and returns the socket it checked', async () => {
  const root = await directory();
  const target = join(root, 'daemon', 'socket');

  await mkdir(join(root, 'daemon'), { mode: 0o700 });
  await listen(target);
  await symlink(target, join(root, 'app-server.sock'));

  expect(await verifyLocalSocket(join(root, 'app-server.sock'))).toBe(await realpath(target));
});

it('refuses a link to a socket in a directory others can write', async () => {
  const root = await directory();
  const shared = join(root, 'shared');
  const target = join(shared, 'socket');

  await mkdir(shared);
  await listen(target);
  await chmod(shared, 0o777);
  await symlink(target, join(root, 'app-server.sock'));

  await expect(verifyLocalSocket(join(root, 'app-server.sock'))).rejects.toThrow(
    ErrorCode.CODEX_INVALID_SOCKET,
  );
});

it('refuses a link to something that is not a socket', async () => {
  const root = await directory();

  await symlink(root, join(root, 'app-server.sock'));

  await expect(verifyLocalSocket(join(root, 'app-server.sock'))).rejects.toThrow(
    ErrorCode.CODEX_INVALID_SOCKET,
  );
});
