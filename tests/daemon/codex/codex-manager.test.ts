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

const connectSocket = vi.hoisted(() => vi.fn());

vi.mock('@daemon/codex/rpc/transport.js', () => ({ connectCodexSocket: connectSocket }));

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
