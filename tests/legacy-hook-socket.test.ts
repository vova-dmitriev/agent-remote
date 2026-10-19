import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, connect, type Server } from 'node:net';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeHookEvent } from '../apps/daemon/src/domain/claude.js';
import { IpcMessageType, LegacyHookSocketState } from '../apps/daemon/src/domain/ipc.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry } from '../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { registerNativeAdapter } from '../apps/daemon/src/runtime/wiring/native-adapter.js';
import { startHookServer } from '../apps/daemon/src/code/hooks/hook-server.js';
import { startLegacyHookSocket } from '../apps/daemon/src/code/hooks/legacy-socket.js';
import { startHookWiring } from '../apps/daemon/src/runtime/wiring/hook-wiring.js';
import { requestLocal } from '../apps/daemon/src/code/hooks/ipc.js';
import { localSecret, socketPath } from '../apps/daemon/src/config.js';

const cleanups: Array<() => Promise<unknown>> = [];
let home: string;
let legacyDirectory: string;
let legacyPath: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'legacy-hooks-')));
  legacyDirectory = join(home, '.claude-remote');
  legacyPath = join(legacyDirectory, 'hooks.sock');
  vi.stubEnv('HOME', home);
  vi.stubEnv('CLAUDE_REMOTE_HOME', join(home, 'companion'));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }

  vi.unstubAllEnvs();
});

async function companion() {
  const directory = join(home, 'companion');

  await mkdir(directory, { mode: 0o700 });

  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker(),
    monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  registerNativeAdapter(adapters, false);

  const listen = (path: string, token: string) =>
    startHookServer({
      path,
      token,
      monitor,
      adapters,
      permissions,
      inputEnabled: false,
      permissionsEnabled: false,
    });

  const token = 'companion-secret';
  const primaryPath = join(directory, 'hooks.sock');
  const primary = await listen(primaryPath, token);

  cleanups.push(async () => {
    await primary.close();
    permissions.close();
    store.close();
  });

  const startLegacy = async () => {
    const legacy = await startLegacyHookSocket(listen);

    cleanups.push(legacy.close);

    return legacy;
  };

  return { monitor, primaryPath, token, startLegacy };
}

const hook = (sessionId: string, hookEventName: string) => ({
  hook_event_name: hookEventName,
  session_id: sessionId,
  cwd: '/synthetic/project',
});

async function liveForeignListener(path: string) {
  const server: Server = createServer((socket) => socket.end());

  await new Promise<void>((resolve) => server.listen(path, resolve));
  await chmod(path, 0o600);
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));

  return server;
}

async function leaveStaleSocket(path: string) {
  const script = `import {createServer} from 'node:net';import {chmodSync} from 'node:fs';const path=process.argv[1];createServer(socket=>socket.destroy()).listen(path,()=>{chmodSync(path,0o600);process.send('ready')});`;

  const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });

  await once(child, 'message');
  const exited = once(child, 'exit');

  child.kill('SIGKILL');
  await exited;
  expect((await lstat(path)).isSocket()).toBe(true);
}

const accepts = (path: string) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(path);

    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.once('error', () => resolve(false));
  });

it('binds the legacy path when it is free with a private socket and directory', async () => {
  const { startLegacy } = await companion();
  const legacy = await startLegacy();

  expect(legacy.state).toBe(LegacyHookSocketState.Listening);
  expect((await lstat(legacyPath)).isSocket()).toBe(true);
  expect((await lstat(legacyPath)).mode & 0o777).toBe(0o600);
  expect((await lstat(legacyDirectory)).mode & 0o777).toBe(0o700);
  expect((await lstat(join(legacyDirectory, 'local.key'))).mode & 0o777).toBe(0o600);
});

it('turns a hook posted the way ~/.claude/settings.json posts it into the same session as the companion socket', async () => {
  const { monitor, primaryPath, token, startLegacy } = await companion();

  await startLegacy();
  vi.stubEnv('CLAUDE_REMOTE_HOME', undefined);
  expect(socketPath()).toBe(legacyPath);

  const legacyReply = await requestLocal(socketPath(), {
    type: IpcMessageType.Hook,
    token: await localSecret(),
    payload: hook('claude-session', ClaudeHookEvent.SessionStart),
  });

  expect(legacyReply).toEqual({ type: IpcMessageType.HookResult, output: {} });
  expect(monitor.snapshot().sessions).toHaveLength(1);
  const viaLegacy = monitor.snapshot().sessions[0]!;

  await requestLocal(primaryPath, {
    type: IpcMessageType.Hook,
    token,
    payload: hook('claude-session', ClaudeHookEvent.UserPromptSubmit),
  });

  expect(monitor.snapshot().sessions).toHaveLength(1);
  expect(monitor.snapshot().sessions[0]!.id).toBe(viaLegacy.id);
});

it('rejects the companion token on the legacy socket', async () => {
  const { monitor, token, startLegacy } = await companion();

  await startLegacy();

  await requestLocal(legacyPath, {
    type: IpcMessageType.Hook,
    token,
    payload: hook('claude-session', ClaudeHookEvent.SessionStart),
  });

  expect(monitor.snapshot().sessions).toHaveLength(0);
});

it('leaves a live CLI daemon socket untouched and reports it as occupied', async () => {
  await mkdir(legacyDirectory, { mode: 0o700 });
  await liveForeignListener(legacyPath);
  const before = await lstat(legacyPath);
  const { startLegacy } = await companion();
  const legacy = await startLegacy();

  expect(legacy.state).toBe(LegacyHookSocketState.Occupied);
  await legacy.close();
  expect((await lstat(legacyPath)).ino).toBe(before.ino);
  expect(await accepts(legacyPath)).toBe(true);
});

it('replaces a stale socket the user owns', async () => {
  await mkdir(legacyDirectory, { mode: 0o700 });
  await leaveStaleSocket(legacyPath);
  const stale = await lstat(legacyPath);
  const { startLegacy } = await companion();
  const legacy = await startLegacy();

  expect(legacy.state).toBe(LegacyHookSocketState.Listening);
  expect((await lstat(legacyPath)).ino).not.toBe(stale.ino);
  expect(await accepts(legacyPath)).toBe(true);
});

it('refuses a symlinked legacy directory', async () => {
  const target = join(home, 'elsewhere');

  await mkdir(target, { mode: 0o700 });
  await symlink(target, legacyDirectory);
  const { startLegacy } = await companion();

  expect((await startLegacy()).state).toBe(LegacyHookSocketState.Refused);
  await expect(lstat(join(target, 'hooks.sock'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses a symlink at the legacy socket path', async () => {
  const target = join(home, 'elsewhere.sock');

  await mkdir(legacyDirectory, { mode: 0o700 });
  await liveForeignListener(target);
  await symlink(target, legacyPath);
  const { startLegacy } = await companion();

  expect((await startLegacy()).state).toBe(LegacyHookSocketState.Refused);
  expect((await lstat(legacyPath)).isSymbolicLink()).toBe(true);
});

it('refuses a group-writable legacy directory', async () => {
  await mkdir(legacyDirectory);
  await chmod(legacyDirectory, 0o770);
  const { startLegacy } = await companion();

  expect((await startLegacy()).state).toBe(LegacyHookSocketState.Refused);
  await expect(lstat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('removes its own legacy socket on shutdown and keeps one that replaced it', async () => {
  const { startLegacy } = await companion();
  const first = await startLegacy();

  await first.close();
  await expect(lstat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });

  const second = await startLegacy();

  expect(second.state).toBe(LegacyHookSocketState.Listening);
  await unlink(legacyPath);
  await liveForeignListener(legacyPath);
  const replacement = await lstat(legacyPath);

  await second.close();
  expect((await lstat(legacyPath)).ino).toBe(replacement.ino);
  expect(await accepts(legacyPath)).toBe(true);
  expect(await readFile(join(legacyDirectory, 'local.key'), 'utf8')).toMatch(/^[a-f0-9]{64}$/);
});

it.each([
  [false, LegacyHookSocketState.Disabled],
  [true, LegacyHookSocketState.Listening],
] as const)(
  'wires the legacy socket only when the companion asks for it (%s)',
  async (legacyClaudeHooks, state) => {
    const directory = join(home, 'companion');

    await mkdir(directory, { mode: 0o700 });

    const store = new LocalStore(':memory:', 'device'),
      adapters = new AdapterRegistry('device'),
      permissions = new PermissionBroker(),
      monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

    const wiring = await startHookWiring({
      path: join(directory, 'hooks.sock'),
      token: 'companion-secret',
      deviceId: 'device',
      monitor,
      adapters,
      permissions,
      inputEnabled: false,
      permissionsEnabled: false,
      codex: {} as never,
      desktopBridge: {} as never,
      desktopBindings: new Map(),
      readers: {} as never,
      legacyClaudeHooks,
    });

    try {
      expect(wiring.legacyHookSocket).toBe(state);
      expect(await accepts(legacyPath)).toBe(legacyClaudeHooks);
    } finally {
      await wiring.close();
      permissions.close();
      store.close();
    }

    await expect(lstat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(join(directory, 'hooks.sock'))).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
