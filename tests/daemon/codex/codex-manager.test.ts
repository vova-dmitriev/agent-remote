import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexManager } from '@daemon/runtime/services/codex-manager.js';
import { codexConnectionSchema } from '@daemon/domain/codex/connection.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { AdapterRegistry } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { registerNativeAdapter } from '@daemon/runtime/wiring/native-adapter.js';
import { CodexRpcError } from '@daemon/codex/rpc/rpc-client.js';

const connectSocket = vi.hoisted(() => vi.fn());

vi.mock('@daemon/codex/rpc/transport.js', () => ({ connectCodexSocket: connectSocket }));

const managedSocket = vi.hoisted(() => vi.fn());

vi.mock('@daemon/codex/launcher.js', async (original) => ({
  ...(await original<object>()),
  ensureManagedCodexSocket: managedSocket,
}));

it('accepts local Codex selection and rejects network endpoints and remote process injection', () => {
  expect(
    codexConnectionSchema.parse({ kind: 'codex-cli', socketPath: '/private/app.sock', threadId: 'exact' })
      .threadId,
  ).toBe('exact');

  expect(
    codexConnectionSchema.safeParse({ kind: 'codex-desktop', socketPath: 'ws://remote', executable: 'sh' })
      .success,
  ).toBe(false);

  expect(codexConnectionSchema.safeParse({ kind: 'codex-cli', socketPath: '../socket' }).success).toBe(false);
});

it('shares auto-discovered endpoints with concurrent explicit selections without another client or generation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-manager-test-'));
  const endpoint = join(directory, 'codex/app-server.sock');

  const rpc = Object.assign(new EventEmitter(), {
    request: vi.fn(async (method: string) => {
      if (method === 'thread/loaded/list') {
        return { data: ['loaded'] };
      }

      if (method === 'thread/read' || method === 'thread/resume') {
        return {
          thread: {
            id: 'loaded',
            name: 'Synthetic',
            canAcceptDirectInput: true,
            status: { type: 'idle' },
            turns: [],
          },
        };
      }

      return { data: [], nextCursor: null };
    }),
    respond() {},
    async close() {},
  });

  connectSocket.mockImplementation(async (path: string) => {
    if (path !== endpoint) {
      throw new Error('CODEX_DISCONNECTED');
    }

    return rpc;
  });

  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  const manager = new CodexManager({
    stateDirectory: directory,
    codexHome: directory,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: true,
  });

  try {
    await manager.start();
    await manager.connect({ kind: 'codex-cli', socketPath: endpoint });
    const generation = monitor.snapshot().sessions[0]!.generation;

    const results = await Promise.all([
      manager.connect({ kind: 'codex-cli', socketPath: endpoint, threadId: 'loaded' }),
      manager.connect({ kind: 'codex-cli', socketPath: endpoint, threadId: 'loaded' }),
    ]);

    expect(results.map((result) => result.connected)).toEqual([1, 1]);
    expect(monitor.snapshot().sessions).toHaveLength(1);
    expect(monitor.snapshot().sessions[0]!.generation).toBe(generation);
    expect(connectSocket.mock.calls.filter(([path]) => path === endpoint)).toHaveLength(1);

    expect(JSON.parse(await readFile(join(directory, 'codex-connections.json'), 'utf8'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ threadId: 'loaded' })]),
    );

    // A thread no app-server serves (a Codex desktop thread) is named through one on the same Codex home.
    expect(await manager.renameThread('desktop-thread', 'Named')).toBe(true);

    expect(rpc.request).toHaveBeenCalledWith('thread/name/set', {
      threadId: 'desktop-thread',
      name: 'Named',
    });
  } finally {
    await manager.close();
    permissions.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('creates a Codex thread while the device has room, under the same limit as every other session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-quota-test-'));

  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  registerNativeAdapter(adapters, false);

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  // Twelve working sessions used to be over Codex's own limit of ten.
  for (let index = 0; index < 12; index++) {
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'active-' + index }, 'native');
    monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 'active-' + index }, 'native');
  }

  expect(monitor.canCreateSession()).toBe(true);

  const manager = new CodexManager({
    stateDirectory: directory,
    codexHome: directory,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
  } as unknown as ConstructorParameters<typeof CodexManager>[0]);

  vi.spyOn(monitor, 'canCreateSession').mockReturnValue(false);

  try {
    await expect(manager.createSession('/synthetic/project')).rejects.toThrow('SESSION_QUOTA');
    expect(connectSocket).not.toHaveBeenCalled();
  } finally {
    await manager.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('binds a Codex thread while the device has room, though twelve other sessions are working', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-bind-test-'));
  const endpoint = join(directory, 'codex/app-server.sock');

  const rpc = Object.assign(new EventEmitter(), {
    request: vi.fn(async (method: string) => {
      if (method === 'thread/loaded/list') {
        return { data: ['loaded'] };
      }

      if (method === 'thread/read' || method === 'thread/resume') {
        return { thread: { id: 'loaded', canAcceptDirectInput: true, status: { type: 'idle' }, turns: [] } };
      }

      return { data: [], nextCursor: null };
    }),
    respond() {},
    async close() {},
  });

  connectSocket.mockImplementation(async () => rpc);

  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  registerNativeAdapter(adapters, false);

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  for (let index = 0; index < 12; index++) {
    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: 'active-' + index }, 'native');
    monitor.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: 'active-' + index }, 'native');
  }

  const manager = new CodexManager({
    stateDirectory: directory,
    codexHome: directory,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
  } as unknown as ConstructorParameters<typeof CodexManager>[0]);

  try {
    await manager.connect({ kind: 'codex-cli', socketPath: endpoint });

    expect(
      monitor
        .snapshot()
        .sessions.find((session) => 'threadId' in session.target && session.target.threadId === 'loaded'),
    ).toMatchObject({ integrationState: 'ready' });
  } finally {
    await manager.close();
    permissions.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('starts a thread on the picked model and binds it, though Codex cannot resume it before its first message', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-fresh-test-'));
  const endpoint = join(directory, 'codex/app-server.sock');
  let started = false;

  const fresh = {
    id: 'fresh',
    cwd: '/synthetic/project',
    canAcceptDirectInput: true,
    status: { type: 'idle' },
    turns: [],
  };

  const rpc = Object.assign(new EventEmitter(), {
    request: vi.fn(async (method: string, params: unknown) => {
      if (method === 'thread/start') {
        started = true;

        return { thread: fresh };
      }

      if (method === 'thread/loaded/list') {
        return { data: started ? ['fresh'] : [] };
      }

      if (method === 'thread/read' && !(params as { includeTurns?: boolean }).includeTurns) {
        return { thread: fresh };
      }

      // Codex writes a thread's rollout with its first turn: an empty thread cannot be resumed or have its turns read.
      if (method === 'thread/resume' || method === 'thread/read') {
        throw new CodexRpcError(-32600);
      }

      return { data: [], nextCursor: null };
    }),
    respond() {},
    async close() {},
  });

  connectSocket.mockImplementation(async () => rpc);
  managedSocket.mockResolvedValue(endpoint);

  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  const manager = new CodexManager({
    stateDirectory: directory,
    codexHome: directory,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
  } as unknown as ConstructorParameters<typeof CodexManager>[0]);

  try {
    const sessionId = await manager.createSession('/synthetic/project', undefined, {
      model: 'synthetic-model',
      effort: 'high',
    });

    expect(monitor.session(sessionId)).toMatchObject({ integrationState: 'ready' });

    // The model the owner picked in the app, instead of the Codex home's default.
    expect(rpc.request).toHaveBeenCalledWith('thread/start', {
      cwd: '/synthetic/project',
      model: 'synthetic-model',
      config: { model_reasoning_effort: 'high' },
    });
  } finally {
    await manager.close();
    permissions.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('binds an empty loaded thread after a restart and follows it once its first message is sent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-empty-test-'));
  const endpoint = join(directory, 'codex/app-server.sock');

  const empty = {
    id: 'empty',
    cwd: '/synthetic/project',
    canAcceptDirectInput: true,
    status: { type: 'idle' },
  };

  let turns = 0;

  const rpc = Object.assign(new EventEmitter(), {
    request: vi.fn(async (method: string) => {
      if (method === 'thread/loaded/list') {
        return { data: ['empty'] };
      }

      if (method === 'thread/read') {
        return { thread: { ...empty, turns: [] } };
      }

      // Codex writes the rollout with the first turn: until then the thread cannot be resumed.
      if (method === 'thread/resume') {
        if (!turns) {
          throw new CodexRpcError(-32600);
        }

        return { thread: { ...empty, turns: [] } };
      }

      if (method === 'turn/start') {
        turns++;

        return { turn: { id: 'turn-1', status: 'inProgress' } };
      }

      return { data: [], nextCursor: null };
    }),
    respond() {},
    async close() {},
  });

  connectSocket.mockImplementation(async () => rpc);

  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  const manager = new CodexManager({
    stateDirectory: directory,
    codexHome: directory,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
  } as unknown as ConstructorParameters<typeof CodexManager>[0]);

  try {
    await manager.connect({ kind: 'codex-cli', socketPath: endpoint });

    const session = monitor
      .snapshot()
      .sessions.find((item) => 'threadId' in item.target && item.target.threadId === 'empty')!;

    expect(session).toMatchObject({ integrationState: 'ready', capabilities: { prompt: true } });

    await adapters.resolve(session.target).sendPrompt(monitor.binding(session.id)!, 'First message');

    const methods = rpc.request.mock.calls.map(([method]) => method);

    expect(methods.lastIndexOf('thread/resume')).toBeGreaterThan(methods.indexOf('turn/start'));
  } finally {
    await manager.close();
    permissions.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
