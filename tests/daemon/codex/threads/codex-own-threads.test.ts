import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { CodexManager } from '@daemon/runtime/services/codex-manager.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { AdapterRegistry } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';

const connectSocket = vi.hoisted(() => vi.fn());
const connectDesktop = vi.hoisted(() => vi.fn());

vi.mock('@daemon/codex/rpc/transport.js', () => ({ connectCodexSocket: connectSocket }));

vi.mock('@daemon/codex/desktop/desktop-ipc.js', () => ({ DesktopIpcClient: { connect: connectDesktop } }));

vi.mock('@daemon/codex/desktop/desktop-client.js', () => ({
  DesktopCodexClient: { attach: () => Promise.reject(new Error('CODEX_DESKTOP_REQUEST_FAILED')) },
}));

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }

  connectDesktop.mockReset();
});

/** A Codex home whose state database holds the given threads, and a manager whose own app-server serves them. */
async function setup(threads: { id: string; originator: string; archived?: number }[]) {
  const directory = await mkdtemp(join(tmpdir(), 'codex-own-threads-'));
  const endpoint = join(directory, 'codex/app-server.sock');
  const db = new Sqlite(join(directory, 'state_5.sqlite'));

  db.exec(
    'CREATE TABLE threads(id TEXT, archived INTEGER, source TEXT, originator TEXT, updated_at_ms INTEGER)',
  );

  for (const [index, thread] of threads.entries()) {
    db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run(
      thread.id,
      thread.archived ?? 0,
      'vscode',
      thread.originator,
      index,
    );
  }

  db.close();

  const loaded = new Set<string>();

  const rpc = Object.assign(new EventEmitter(), {
    request: vi.fn(async (method: string, params: { threadId?: string }) => {
      if (method === 'thread/loaded/list') {
        return { data: [...loaded], nextCursor: null };
      }

      if (method === 'thread/read' || method === 'thread/resume') {
        loaded.add(params.threadId!);

        return {
          thread: {
            id: params.threadId,
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

  cleanups.push(async () => {
    await manager.close();
    permissions.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  const threadIds = () =>
    monitor
      .snapshot()
      .sessions.map((session) => ('threadId' in session.target ? session.target.threadId : ''));

  return { manager, rpc, threadIds };
}

it('follows the threads the app started on its own app-server again after a restart, though Codex unloaded them', async () => {
  connectDesktop.mockRejectedValue(new Error('ENOENT'));

  const { manager, threadIds } = await setup([
    { id: 'started-by-app', originator: 'claude_remote' },
    { id: 'archived-by-app', originator: 'claude_remote', archived: 1 },
    { id: 'typed-in-terminal', originator: '' },
  ]);

  await manager.start();
  await vi.waitFor(() => expect(threadIds()).toEqual(['started-by-app']));
});

it("follows Codex Desktop's threads on the daemon's own app-server while Codex Desktop is closed", async () => {
  connectDesktop.mockRejectedValue(new Error('ENOENT'));

  const { manager, threadIds } = await setup([{ id: 'desktop-thread', originator: 'Codex Desktop' }]);

  await manager.start();
  await vi.waitFor(() => expect(threadIds()).toEqual(['desktop-thread']));
});

it('leaves a thread Codex Desktop hosts to Codex Desktop', async () => {
  connectDesktop.mockResolvedValue({
    owner: async () => 'desktop-window',
    frameTooLarge: () => false,
    once() {},
    async close() {},
  });

  const { manager, rpc, threadIds } = await setup([{ id: 'desktop-thread', originator: 'Codex Desktop' }]);

  await manager.start();
  await vi.waitFor(() => expect(connectDesktop).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(threadIds()).toEqual([]);
  expect(rpc.request).not.toHaveBeenCalledWith('thread/resume', expect.anything());
});
