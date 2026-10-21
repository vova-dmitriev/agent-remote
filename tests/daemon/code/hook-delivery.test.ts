import { afterEach, beforeEach, expect, it } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliverHook, hookTargets, removeHookPeer, writeHookPeer } from '@daemon/code/hooks/hook-delivery.js';
import { lineReader, writeFrame } from '@daemon/code/hooks/ipc.js';
import { localSecret } from '@daemon/config.js';

let dir: string;
let previousHome: string | undefined;
const servers: Server[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hook-delivery-'));
  previousHome = process.env.CLAUDE_REMOTE_HOME;
  process.env.CLAUDE_REMOTE_HOME = join(dir, 'cli');
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));

  if (previousHome === undefined) {
    delete process.env.CLAUDE_REMOTE_HOME;
  } else {
    process.env.CLAUDE_REMOTE_HOME = previousHome;
  }

  await rm(dir, { recursive: true, force: true });
});

/** A daemon's hook socket that answers each hook after `delayMs` (never, when undefined). */
async function daemon(name: string, output: object, delayMs?: number, settled = false) {
  const path = join(dir, name + '.sock');
  const frames: unknown[] = [];
  const closed: Socket[] = [];

  const server = createServer((socket) => {
    socket.on('close', () => closed.push(socket));

    lineReader(socket, (frame) => {
      frames.push(frame);

      if (delayMs !== undefined) {
        setTimeout(
          () =>
            !socket.destroyed &&
            writeFrame(socket, { type: 'hook_result', output, ...(settled ? { settled } : {}) }),
          delayMs,
        );
      }
    });
  });

  await new Promise<void>((done) => server.listen(path, done));
  servers.push(server);

  return { path, frames, closed };
}

it('gives every daemon the hook and takes the first real decision, cancelling the rest', async () => {
  const cli = await daemon('cli', {}, 0);
  const desktop = await daemon('desktop', { decision: 'allow' }, 50);
  const silent = await daemon('silent', {});

  const output = await deliverHook(
    [cli, desktop, silent].map(({ path }) => ({ path, token: 't-' + path })),
    { type: 'hook', payload: { hook_event_name: 'PermissionRequest' } },
    5000,
  );

  expect(output).toEqual({ decision: 'allow' });
  expect(cli.frames).toEqual([expect.objectContaining({ token: 't-' + cli.path })]);
  expect(desktop.frames).toHaveLength(1);
  await expect.poll(() => silent.closed.length).toBe(1);
});

it('answers nothing when no daemon decides or none is listening', async () => {
  const cli = await daemon('cli', {}, 0);

  expect(
    await deliverHook(
      [cli.path, join(dir, 'missing.sock')].map((path) => ({ path, token: 't' })),
      { type: 'hook', payload: {} },
      1000,
    ),
  ).toEqual({});
});

it('adds a desktop companion that yielded the hook path, never the CLI daemon twice', async () => {
  const companion = join(dir, 'companion');

  await localSecret(companion);
  expect(await hookTargets()).toHaveLength(1);

  await writeHookPeer(companion, join(dir, 'cli'));
  const targets = await hookTargets();

  expect(targets.map((target) => target.path)).toEqual([
    join(dir, 'cli', 'hooks.sock'),
    join(companion, 'hooks.sock'),
  ]);

  expect(targets[1]!.token).toBe(await localSecret(companion));

  await writeHookPeer(join(dir, 'cli'), join(dir, 'cli'));
  expect(await hookTargets()).toHaveLength(1);

  await removeHookPeer(join(dir, 'cli'));
  expect(await hookTargets()).toHaveLength(1);
});

it("takes a daemon's settled answer even when it is empty, so an owner's allow beats another daemon's later deny", async () => {
  const allowed = await daemon('allowed', {}, 10, true);
  const waiting = await daemon('waiting', { hookSpecificOutput: { permissionDecision: 'deny' } }, 500);

  const output = await deliverHook(
    [allowed, waiting].map(({ path }) => ({ path, token: 't' })),
    { type: 'hook', payload: { hook_event_name: 'PreToolUse' } },
    5000,
  );

  expect(output).toEqual({});
  await expect.poll(() => waiting.closed.length).toBe(1);
});
