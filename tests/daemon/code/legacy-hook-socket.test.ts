import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, connect, type Server } from 'node:net';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorCode, TargetKind } from '@protocol';
import { ClaudeHookEvent } from '@daemon/domain/claude.js';
import { DesktopMode } from '@daemon/domain/desktop.js';
import { IpcMessageType, LegacyHookSocketState } from '@daemon/domain/ipc.js';
import { DaemonErrorCode } from '@daemon/error-codes.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { AdapterRegistry } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { registerNativeAdapter } from '@daemon/runtime/wiring/native-adapter.js';
import { startHookServer, type HookSocketOptions } from '@daemon/code/hooks/hook-server.js';
import { startLegacyHookSocket } from '@daemon/code/hooks/legacy-socket.js';
import { startHookWiring } from '@daemon/runtime/wiring/hook-wiring.js';
import { requestLocal } from '@daemon/code/hooks/ipc.js';
import { deliverHook, hookTargets } from '@daemon/code/hooks/hook-delivery.js';
import { existsSync } from 'node:fs';
import { localSecret, socketPath } from '@daemon/config.js';

const RETRY_MS = 20;
const cleanups: Array<() => Promise<unknown>> = [];
let home: string;
let legacyDirectory: string;
let legacyPath: string;
let legacyToken: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'legacy-hooks-')));
  legacyDirectory = join(home, '.claude-remote');
  legacyPath = join(legacyDirectory, 'hooks.sock');
  vi.stubEnv('HOME', home);
  vi.stubEnv('CLAUDE_REMOTE_HOME', join(home, 'companion'));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  // What the CLI (`remote hook`, `remote start`) leaves behind in its default home.
  legacyToken = await localSecret(legacyDirectory);
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }

  vi.unstubAllEnvs();
});

function runtime() {
  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker(),
    monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  registerNativeAdapter(adapters, false);

  cleanups.push(async () => {
    permissions.close();
    store.close();
  });

  return { store, adapters, permissions, monitor };
}

async function companion() {
  const directory = join(home, 'companion');

  await mkdir(directory, { mode: 0o700 });

  const { adapters, permissions, monitor } = runtime();
  const desktopBinds = vi.fn(async () => ({ sessionId: 'desktop', state: 'ready' }));
  const codexConnects = vi.fn(async () => ({ connected: 1 }));

  const listen = (socket: HookSocketOptions) =>
    startHookServer({
      ...socket,
      monitor,
      adapters,
      permissions,
      inputEnabled: true,
      permissionsEnabled: false,
      onDesktopBind: desktopBinds,
      onCodexConnect: codexConnects,
    });

  const token = 'companion-secret';
  const primaryPath = join(directory, 'hooks.sock');
  const primary = await listen({ path: primaryPath, token });

  cleanups.push(() => primary.close());

  const startLegacy = async () => {
    const legacy = await startLegacyHookSocket(listen, { retryMs: RETRY_MS });

    cleanups.push(() => legacy.close());

    return legacy;
  };

  return { monitor, adapters, primaryPath, token, startLegacy, desktopBinds, codexConnects };
}

/** `remote start`: the CLI daemon's hook wiring on its own (legacy) path. */
async function cliDaemon() {
  const { adapters, permissions, monitor } = runtime();

  const wiring = await startHookWiring({
    path: legacyPath,
    token: legacyToken,
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
    legacyClaudeHooks: false,
    store: { cmuxSessions: () => [] },
    nativeProcesses: { live: async () => [] } as never,
  });

  cleanups.push(() => wiring.close());

  return { wiring, monitor };
}

const hook = (sessionId: string, hookEventName: string) => ({
  hook_event_name: hookEventName,
  session_id: sessionId,
  cwd: '/synthetic/project',
});

const postHook = (path: string, token: string, sessionId = 'claude-session') =>
  requestLocal(path, {
    type: IpcMessageType.Hook,
    token,
    payload: hook(sessionId, ClaudeHookEvent.SessionStart),
  });

async function liveForeignListener(path: string) {
  const server: Server = createServer((socket) => socket.destroy());

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

async function until(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not reached');
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

it('binds the legacy path when it is free with a private socket', async () => {
  const { startLegacy } = await companion();
  const legacy = await startLegacy();

  expect(legacy.state).toBe(LegacyHookSocketState.Listening);
  expect((await lstat(legacyPath)).isSocket()).toBe(true);
  expect((await lstat(legacyPath)).mode & 0o777).toBe(0o600);
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

it('rejects the companion token on the legacy socket and the legacy token on the companion socket', async () => {
  const { monitor, primaryPath, token, startLegacy } = await companion();

  await startLegacy();
  await postHook(legacyPath, token, 'with-companion-token');
  await postHook(primaryPath, legacyToken, 'with-legacy-token');

  expect(monitor.snapshot().sessions).toHaveLength(0);
});

it('accepts only hooks on the legacy socket and leaves the companion socket unchanged', async () => {
  const { adapters, primaryPath, token, startLegacy, desktopBinds, codexConnects } = await companion();

  await startLegacy();
  const wrapperId = randomUUID();
  const codex = { kind: TargetKind.CodexCli, socketPath: '/synthetic/codex.sock' };

  expect(
    await requestLocal(legacyPath, { type: IpcMessageType.Wrapper, token: legacyToken, wrapperId }),
  ).toEqual({
    type: IpcMessageType.HookResult,
    output: {},
  });

  expect(
    await requestLocal(legacyPath, {
      type: IpcMessageType.DesktopBind,
      token: legacyToken,
      mode: DesktopMode.Chat,
    }),
  ).toEqual({ type: IpcMessageType.DesktopResult, code: ErrorCode.CAPABILITY_UNAVAILABLE });

  expect(
    await requestLocal(legacyPath, { type: IpcMessageType.CodexConnect, token: legacyToken, codex }),
  ).toEqual({
    type: IpcMessageType.CodexResult,
    code: ErrorCode.CAPABILITY_UNAVAILABLE,
  });

  expect(adapters.get(wrapperId)).toBeUndefined();
  expect(desktopBinds).not.toHaveBeenCalled();
  expect(codexConnects).not.toHaveBeenCalled();
  expect((await postHook(legacyPath, legacyToken)).type).toBe(IpcMessageType.HookResult);

  expect(
    await requestLocal(primaryPath, { type: IpcMessageType.DesktopBind, token, mode: DesktopMode.Chat }),
  ).toEqual({
    type: IpcMessageType.DesktopResult,
    result: { sessionId: 'desktop', state: 'ready' },
  });

  expect(await requestLocal(primaryPath, { type: IpcMessageType.CodexConnect, token, codex })).toEqual({
    type: IpcMessageType.CodexResult,
    result: { connected: 1 },
  });

  expect(await requestLocal(primaryPath, { type: IpcMessageType.Wrapper, token, wrapperId })).toEqual({
    type: IpcMessageType.Registered,
  });

  expect(await requestLocal(primaryPath, { type: IpcMessageType.ReleaseHookSocket, token })).toEqual({
    type: IpcMessageType.ReleaseResult,
    code: ErrorCode.CAPABILITY_UNAVAILABLE,
  });

  expect(await accepts(primaryPath)).toBe(true);
});

it('leaves a live CLI daemon socket untouched while occupied and takes the path once it is free', async () => {
  const foreign = await liveForeignListener(legacyPath);
  const before = await lstat(legacyPath);
  const { monitor, startLegacy } = await companion();
  const legacy = await startLegacy();

  expect(legacy.state).toBe(LegacyHookSocketState.Occupied);
  await new Promise((resolve) => setTimeout(resolve, RETRY_MS * 3));
  expect((await lstat(legacyPath)).ino).toBe(before.ino);
  expect(await accepts(legacyPath)).toBe(true);

  await new Promise((resolve) => foreign.close(resolve));
  await until(() => legacy.state === LegacyHookSocketState.Listening);
  await postHook(legacyPath, legacyToken);
  expect(monitor.snapshot().sessions).toHaveLength(1);
});

it('replaces a stale socket the user owns', async () => {
  await leaveStaleSocket(legacyPath);
  const stale = await lstat(legacyPath);
  const { startLegacy } = await companion();
  const legacy = await startLegacy();

  expect(legacy.state).toBe(LegacyHookSocketState.Listening);
  expect((await lstat(legacyPath)).ino).not.toBe(stale.ino);
  expect(await accepts(legacyPath)).toBe(true);
});

it('refuses a stale socket that is not 0600 without deleting it', async () => {
  await leaveStaleSocket(legacyPath);
  await chmod(legacyPath, 0o644);
  const stale = await lstat(legacyPath);
  const { startLegacy } = await companion();

  expect((await startLegacy()).state).toBe(LegacyHookSocketState.Refused);
  expect((await lstat(legacyPath)).ino).toBe(stale.ino);
});

it('refuses a symlinked legacy directory', async () => {
  const target = join(home, 'elsewhere');

  await rm(legacyDirectory, { recursive: true });
  await mkdir(target, { mode: 0o700 });
  await localSecret(target);
  await symlink(target, legacyDirectory);
  const { startLegacy } = await companion();

  expect((await startLegacy()).state).toBe(LegacyHookSocketState.Refused);
  await expect(lstat(join(target, 'hooks.sock'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses a symlink at the legacy socket path', async () => {
  const target = join(home, 'elsewhere.sock');

  await liveForeignListener(target);
  await symlink(target, legacyPath);
  const { startLegacy } = await companion();

  expect((await startLegacy()).state).toBe(LegacyHookSocketState.Refused);
  expect((await lstat(legacyPath)).isSymbolicLink()).toBe(true);
});

it('refuses a group-writable legacy directory', async () => {
  await chmod(legacyDirectory, 0o770);
  const { startLegacy } = await companion();

  expect((await startLegacy()).state).toBe(LegacyHookSocketState.Refused);
  await expect(lstat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([
  ['missing', async (key: string) => unlink(key)],
  ['empty', async (key: string) => writeFile(key, '', { mode: 0o600 })],
  ['not hex', async (key: string) => writeFile(key, 'x'.repeat(64), { mode: 0o600 })],
  ['shared', async (key: string) => chmod(key, 0o644)],
  [
    'a symlink',
    async (key: string) => {
      const target = join(home, 'elsewhere.key');

      await writeFile(target, 'a'.repeat(64), { mode: 0o600 });
      await unlink(key);
      await symlink(target, key);
    },
  ],
] as const)(
  'disables the legacy socket when the CLI key is %s, without creating one',
  async (_name, spoil) => {
    const key = join(legacyDirectory, 'local.key');

    await spoil(key);
    const before = await lstat(key).catch(() => undefined);
    const { startLegacy } = await companion();

    expect((await startLegacy()).state).toBe(LegacyHookSocketState.KeyUnavailable);
    await expect(lstat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(key).catch(() => undefined))?.ino).toBe(before?.ino);
  },
);

it('disables the legacy socket without creating the CLI home when it is missing', async () => {
  await rm(legacyDirectory, { recursive: true });
  const { startLegacy } = await companion();

  expect((await startLegacy()).state).toBe(LegacyHookSocketState.KeyUnavailable);
  await expect(lstat(legacyDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
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
});

it('yields the legacy path to `remote start` and takes it back after the CLI daemon stops', async () => {
  const companionSide = await companion();
  const legacy = await companionSide.startLegacy();

  expect(legacy.state).toBe(LegacyHookSocketState.Listening);

  const cli = await cliDaemon();

  expect([LegacyHookSocketState.Released, LegacyHookSocketState.Occupied]).toContain(legacy.state);
  await postHook(legacyPath, legacyToken, 'while-cli-runs');
  expect(cli.monitor.snapshot().sessions).toHaveLength(1);
  expect(companionSide.monitor.snapshot().sessions).toHaveLength(0);

  await until(() => legacy.state === LegacyHookSocketState.Occupied);
  expect(cli.wiring.legacyHookSocket).toBe(LegacyHookSocketState.Disabled);

  await cli.wiring.close();
  await until(() => legacy.state === LegacyHookSocketState.Listening);
  await postHook(legacyPath, legacyToken, 'after-cli-stopped');
  expect(companionSide.monitor.snapshot().sessions).toHaveLength(1);
});

it('refuses a release request without the CLI key', async () => {
  const { startLegacy } = await companion();
  const legacy = await startLegacy();

  expect(
    await requestLocal(legacyPath, { type: IpcMessageType.ReleaseHookSocket, token: 'f'.repeat(64) }),
  ).toEqual({ type: IpcMessageType.ReleaseResult, code: ErrorCode.UNAUTHORIZED });

  expect(legacy.state).toBe(LegacyHookSocketState.Listening);
  expect(await accepts(legacyPath)).toBe(true);
});

it('fails `remote start` with a named code when the holder does not release the path', async () => {
  await liveForeignListener(legacyPath);

  await expect(cliDaemon()).rejects.toThrow(DaemonErrorCode.HOOK_SOCKET_HELD_BY_COMPANION);
  expect(await accepts(legacyPath)).toBe(true);
});

it('keeps reporting DAEMON_ALREADY_RUNNING when another CLI daemon holds the path', async () => {
  await cliDaemon();

  await expect(cliDaemon()).rejects.toThrow(DaemonErrorCode.DAEMON_ALREADY_RUNNING);
  expect(await accepts(legacyPath)).toBe(true);
});

it.each([
  [false, LegacyHookSocketState.Disabled],
  [true, LegacyHookSocketState.Listening],
] as const)(
  'wires the legacy socket only when the companion asks for it (%s)',
  async (legacyClaudeHooks, state) => {
    const directory = join(home, 'companion');

    await mkdir(directory, { mode: 0o700 });
    const { adapters, permissions, monitor } = runtime();

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
      store: { cmuxSessions: () => [] },
      nativeProcesses: { live: async () => [] } as never,
    });

    try {
      expect(wiring.legacyHookSocket).toBe(state);
      expect(await accepts(legacyPath)).toBe(legacyClaudeHooks);
    } finally {
      await wiring.close();
    }

    await expect(lstat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(join(directory, 'hooks.sock'))).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('delivers `remote hook` to both the CLI daemon and a desktop companion that yielded it the path', async () => {
  const cli = await cliDaemon();
  const directory = join(home, 'companion');
  const { adapters, permissions, monitor } = runtime();

  const wiring = await startHookWiring({
    path: join(directory, 'hooks.sock'),
    token: await localSecret(directory),
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
    legacyClaudeHooks: true,
    store: { cmuxSessions: () => [] },
    nativeProcesses: { live: async () => [] } as never,
  });

  try {
    expect(wiring.legacyHookSocket).toBe(LegacyHookSocketState.Occupied);

    // `remote hook` runs without CLAUDE_REMOTE_HOME, from the CLI default home.
    vi.stubEnv('CLAUDE_REMOTE_HOME', undefined);
    await until(() => existsSync(join(legacyDirectory, 'hook-peer.json')));

    expect(
      await deliverHook(
        await hookTargets(),
        { type: IpcMessageType.Hook, payload: hook('both', ClaudeHookEvent.SessionStart) },
        1500,
      ),
    ).toEqual({});

    expect(cli.monitor.snapshot().sessions).toHaveLength(1);
    expect(monitor.snapshot().sessions).toHaveLength(1);
  } finally {
    await wiring.close();
  }

  expect(existsSync(join(legacyDirectory, 'hook-peer.json'))).toBe(false);
});
