import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexManager } from '../apps/daemon/src/runtime/services/codex-manager.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry } from '../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';

const connectSocket = vi.hoisted(() => vi.fn());

vi.mock('../apps/daemon/src/codex/rpc/transport.js', () => ({ connectCodexSocket: connectSocket }));

vi.mock('../apps/daemon/src/codex/launcher.js', () => ({
  ensureManagedCodexSocket: async (directory: string) => join(directory, 'codex/app-server.sock'),
}));

it('starts a new managed CLI thread in the chosen project and binds its actual identity without an automatic prompt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-create-'));
  const calls: { method: string; params: unknown }[] = [];
  let created = false;

  const thread = {
    id: 'fresh-thread',
    cwd: '/synthetic/project',
    canAcceptDirectInput: true,
    status: { type: 'idle' },
    turns: [],
  };

  const rpc = Object.assign(new EventEmitter(), {
    async request(method: string, params: unknown) {
      calls.push({ method, params });

      if (method === 'thread/loaded/list') {
        return { data: created ? [thread.id] : [] };
      }

      if (method === 'thread/start') {
        created = true;

        return { thread };
      }

      if (method === 'thread/read' || method === 'thread/resume') {
        return { thread, model: 'synthetic-model' };
      }

      return { data: [], nextCursor: null };
    },
    respond() {},
    async close() {},
  });

  connectSocket.mockImplementation(async (path: string) => {
    if (path !== join(directory, 'codex/app-server.sock')) {
      throw new Error('CODEX_DISCONNECTED');
    }

    return rpc;
  });

  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  const monitor = new Monitor({
    deviceId: 'device',
    store,
    adapters,
    permissions,
    allowSessionCreation: true,
  });

  const manager = new CodexManager({
    stateDirectory: directory,
    codexHome: directory,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
  });

  try {
    await manager.start();
    const sessionId = await manager.createSession('/synthetic/project');

    expect(monitor.session(sessionId)).toMatchObject({
      cwd: '/synthetic/project',
      target: { kind: 'codex-cli', threadId: 'fresh-thread' },
      binding: 'verified',
      capabilities: { prompt: true, createSession: true },
    });

    expect(calls.filter((call) => call.method === 'thread/start')).toEqual([
      { method: 'thread/start', params: { cwd: '/synthetic/project' } },
    ]);

    expect(calls.some((call) => call.method === 'turn/start')).toBe(false);
  } finally {
    await manager.close();
    permissions.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
