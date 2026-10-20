import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, connect } from 'node:net';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as fs from 'node:fs/promises';
import { DaemonErrorCode } from '../../../apps/daemon/src/error-codes.js';
import { bindHookSocket } from '../../../apps/daemon/src/code/hooks/hook-socket.js';

const failures = vi.hoisted(() => ({
  beforeLink: undefined as ((path: string) => Promise<void>) | undefined,
  unlinkStaging: undefined as NodeJS.ErrnoException | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();

  return {
    ...original,
    link: async (existing: string, path: string) => {
      await failures.beforeLink?.(path);

      return original.link(existing, path);
    },
    unlink: async (path: string) => {
      if (failures.unlinkStaging && basename(path).startsWith('.')) {
        throw failures.unlinkStaging;
      }

      return original.unlink(path);
    },
  };
});

let directory: string;
let path: string;

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'hook-bind-')));
  path = join(directory, 'hooks.sock');
});

afterEach(async () => {
  failures.beforeLink = undefined;
  failures.unlinkStaging = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});

const accepts = (target: string) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(target);

    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.once('error', () => resolve(false));
  });

it('reports DAEMON_ALREADY_RUNNING and leaves no staging socket when the path appears before link()', async () => {
  const server = createServer();

  failures.beforeLink = (target) => fs.writeFile(target, 'appeared meanwhile', { mode: 0o600 });

  await expect(bindHookSocket(server, path)).rejects.toThrow(DaemonErrorCode.DAEMON_ALREADY_RUNNING);
  expect(server.listening).toBe(false);
  expect(await fs.readdir(directory)).toEqual(['hooks.sock']);
  expect(await fs.readFile(path, 'utf8')).toBe('appeared meanwhile');
});

it('removes its own linked socket when the staging name cannot be unlinked', async () => {
  const server = createServer();

  failures.unlinkStaging = Object.assign(new Error('EPERM'), { code: 'EPERM' });

  await expect(bindHookSocket(server, path)).rejects.toThrow('EPERM');
  failures.unlinkStaging = undefined;
  expect(server.listening).toBe(false);
  expect(await accepts(path)).toBe(false);
  await expect(fs.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('binds a private socket at the final path and removes it on close', async () => {
  const server = createServer((socket) => socket.destroy());
  const binding = await bindHookSocket(server, path);

  expect((await fs.lstat(path)).mode & 0o777).toBe(0o600);
  expect(await fs.readdir(directory)).toEqual(['hooks.sock']);
  expect(await accepts(path)).toBe(true);
  await binding.close();
  expect(await fs.readdir(directory)).toEqual([]);
});
