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
const managedSocket = vi.hoisted(() => vi.fn());
const stopSocket = vi.hoisted(() => vi.fn());

vi.mock('@daemon/codex/launcher.js', async (original) => ({
  ...(await original<object>()),
  ensureManagedCodexSocket: managedSocket,
  stopManagedCodexSocket: stopSocket,
}));

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
  stopSocket.mockReset();
});

/** A Codex home whose state database holds the given threads, and a manager whose own app-server serves them. */
async function setup(threads: { id: string; originator: string; archived?: number }[], running = true) {
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

  let started = running;

  managedSocket.mockReset().mockImplementation(async () => {
    started = true;

    return endpoint;
  });

  connectSocket.mockImplementation(async (path: string) => {
    if (path !== endpoint || !started) {
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

it("leaves Codex Desktop's threads to it while it is closed: loading one here would lock it against Codex Desktop", async () => {
  connectDesktop.mockRejectedValue(new Error('ENOENT'));

  const { manager, rpc, threadIds } = await setup(
    [{ id: 'desktop-thread', originator: 'Codex Desktop' }],
    false,
  );

  await manager.start();
  await vi.waitFor(() => expect(connectDesktop.mock.calls.length).toBeGreaterThan(1), { timeout: 5000 });

  expect(threadIds()).toEqual([]);
  expect(managedSocket).not.toHaveBeenCalled();
  expect(rpc.request).not.toHaveBeenCalledWith('thread/resume', expect.anything());
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

it('continues a Codex thread by the id the owner pasted', async () => {
  connectDesktop.mockRejectedValue(new Error('ENOENT'));

  const { manager, threadIds } = await setup([]);

  await manager.start();

  await expect(manager.resumeThread('pasted-thread')).resolves.toEqual(expect.any(String));
  expect(threadIds()).toEqual(['pasted-thread']);
});

it('restarts its own app-server once Codex Desktop is back, letting go of a thread the owner continued here', async () => {
  connectDesktop.mockRejectedValue(new Error('ENOENT'));
  stopSocket.mockResolvedValue(true);

  const { manager } = await setup([{ id: 'desktop-thread', originator: 'Codex Desktop' }]);

  await manager.start();
  await manager.resumeThread('desktop-thread');
  managedSocket.mockClear();
  expect(stopSocket).not.toHaveBeenCalled();

  connectDesktop.mockResolvedValue({
    owner: async () => null,
    frameTooLarge: () => false,
    once() {},
    async close() {},
  });

  await vi.waitFor(() => expect(stopSocket).toHaveBeenCalledTimes(1), { timeout: 5000 });
  await vi.waitFor(() => expect(managedSocket).toHaveBeenCalled());
});

it('keeps its own app-server while it holds only the threads this app started', async () => {
  connectDesktop.mockResolvedValue({
    owner: async () => null,
    frameTooLarge: () => false,
    once() {},
    async close() {},
  });

  const { manager, threadIds } = await setup([{ id: 'started-by-app', originator: 'claude_remote' }]);

  await manager.start();
  await vi.waitFor(() => expect(threadIds()).toEqual(['started-by-app']));
  await new Promise((resolve) => setTimeout(resolve, 3500));

  expect(stopSocket).not.toHaveBeenCalled();
});

it("asks Codex Desktop for its threads' owners at once: an unopened thread answers only after a wait", async () => {
  let asking = 0,
    most = 0;

  connectDesktop.mockResolvedValue({
    owner: async () => {
      most = Math.max(most, ++asking);
      await new Promise((resolve) => setTimeout(resolve, 200));
      asking--;

      return null;
    },
    frameTooLarge: () => false,
    once() {},
    async close() {},
  });

  const threads = ['a', 'b', 'c', 'd'].map((id) => ({ id: 'desktop-' + id, originator: 'Codex Desktop' }));
  const { manager } = await setup(threads);

  await manager.start();
  await vi.waitFor(() => expect(most).toBe(threads.length));
});
