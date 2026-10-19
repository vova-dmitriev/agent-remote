import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BindingState, CodedError, ErrorCode, IntegrationState, TargetKind } from '@protocol';
import { RuntimeEvent } from '../apps/daemon/src/domain/runtime.js';
import { CodexMethod, CodexRuntimeStatus } from '../apps/daemon/src/domain/codex/codex.js';
import { CodexManager } from '../apps/daemon/src/codex/manager.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry } from '../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';

const native = vi.hoisted(() => ({ connect: vi.fn(), attach: vi.fn() }));

vi.mock('../apps/daemon/src/codex/rpc/transport.js', () => ({
  connectCodexSocket: async () => {
    throw new Error('Synthetic unavailable endpoint');
  },
}));

vi.mock('../apps/daemon/src/codex/desktop/desktop-ipc.js', () => ({
  DesktopIpcClient: { connect: native.connect },
}));

vi.mock('../apps/daemon/src/codex/desktop/desktop-client.js', () => ({
  DesktopCodexClient: { attach: native.attach },
}));

const SMALL = 'synthetic-small-thread';
const LARGE = 'synthetic-large-thread';
const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }

  native.connect.mockReset();
  native.attach.mockReset();
});

function threadClient(threadId: string) {
  return Object.assign(new EventEmitter(), {
    request: vi.fn(async (method: string) => {
      if (method === CodexMethod.ThreadLoadedList) {
        return { data: [threadId] };
      }

      if (method === CodexMethod.ThreadRead || method === CodexMethod.ThreadResume) {
        return {
          thread: {
            id: threadId,
            canAcceptDirectInput: true,
            status: { type: CodexRuntimeStatus.Idle },
            turns: [],
          },
        };
      }

      return { data: [], nextCursor: null };
    }),
    respond() {},
    close: vi.fn(async () => {}),
  });
}

/** A shared desktop IPC where `oversized` threads send state frames above the cap; `drained` is what the IPC saw. */
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'codex-thread-too-large-'));
  const oversized = new Set<string>();
  const drained = new Set<string>();

  const ipc = Object.assign(new EventEmitter(), {
    owner: async () => 'synthetic-owner',
    frameTooLarge: (id: string, owner: string) => owner === 'synthetic-owner' && drained.has(id),
    close: vi.fn(async () => {}),
  });

  const clients = new Map<string, ReturnType<typeof threadClient>>();

  native.connect.mockResolvedValue(ipc);

  native.attach.mockImplementation(async (_ipc: unknown, id: string) => {
    if (oversized.has(id)) {
      drained.add(id);
      throw new CodedError(ErrorCode.CODEX_FRAME_TOO_LARGE);
    }

    const client = threadClient(id);

    clients.set(id, client);

    return client;
  });

  const store = new LocalStore(':memory:', 'device');
  const permissions = new PermissionBroker();
  const adapters = new AdapterRegistry('device');
  const monitor = new Monitor({ deviceId: 'device', store, permissions, adapters });

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

  const select = (threadId: string) =>
    manager.connect({ kind: TargetKind.CodexDesktop, socketPath: join(directory, 'ipc.sock'), threadId });

  const session = (threadId: string) =>
    monitor
      .snapshot()
      .sessions.find((candidate) => 'threadId' in candidate.target && candidate.target.threadId === threadId);

  const attaches = (threadId: string) => native.attach.mock.calls.filter(([, id]) => id === threadId).length;

  return { ipc, oversized, drained, clients, manager, monitor, select, session, attaches };
}

it('keeps other threads bound and names the reason on the thread whose snapshot is too large', async () => {
  const t = await setup();

  t.oversized.add(LARGE);
  await t.select(SMALL);
  await expect(t.select(LARGE)).rejects.toThrow(ErrorCode.CODEX_THREAD_NOT_LOADED);

  expect(t.session(SMALL)).toMatchObject({
    integrationState: IntegrationState.Ready,
    binding: BindingState.Verified,
  });

  expect(t.session(SMALL)!.errorCode).toBeUndefined();

  expect(t.session(LARGE)).toMatchObject({
    integrationState: IntegrationState.Disconnected,
    binding: BindingState.Unverified,
    errorCode: ErrorCode.CODEX_FRAME_TOO_LARGE,
    capabilities: { observe: false, prompt: false },
  });

  // Polling must not ask Codex for the oversize snapshot again on the same connection.
  await t.manager.start();
  await t.select(SMALL);
  expect(t.attaches(LARGE)).toBe(1);
  expect(t.ipc.close).not.toHaveBeenCalled();
});

it('marks a bound thread that later grows past the cap without touching its neighbours', async () => {
  const t = await setup();

  await t.select(SMALL);
  await t.select(LARGE);
  const before = t.session(LARGE)!;

  t.oversized.add(LARGE);
  t.drained.add(LARGE);
  t.clients.get(LARGE)!.emit(RuntimeEvent.Disconnected, new CodedError(ErrorCode.CODEX_FRAME_TOO_LARGE));
  await t.manager.start();
  await t.select(SMALL);

  expect(t.session(LARGE)).toMatchObject({
    id: before.id,
    integrationState: IntegrationState.Disconnected,
    errorCode: ErrorCode.CODEX_FRAME_TOO_LARGE,
  });

  expect(t.session(SMALL)).toMatchObject({ integrationState: IntegrationState.Ready });
  expect(t.attaches(LARGE)).toBe(1);
  expect(t.attaches(SMALL)).toBe(1);
});

it('retries an oversize thread once its mark expires and recovers it when it has shrunk', async () => {
  const t = await setup();

  t.oversized.add(LARGE);
  await expect(t.select(LARGE)).rejects.toThrow(ErrorCode.CODEX_THREAD_NOT_LOADED);
  expect(t.session(LARGE)!.errorCode).toBe(ErrorCode.CODEX_FRAME_TOO_LARGE);

  // The IPC forgets the mark after its retry interval; the thread meanwhile fits under the cap.
  t.drained.delete(LARGE);
  t.oversized.delete(LARGE);
  await t.select(LARGE);

  expect(t.attaches(LARGE)).toBe(2);

  expect(t.session(LARGE)).toMatchObject({
    integrationState: IntegrationState.Ready,
    binding: BindingState.Verified,
  });

  expect(t.session(LARGE)!.errorCode).toBeUndefined();
});

it('reconnects the shared IPC after it disconnects and rebinds its threads', async () => {
  const t = await setup();

  const replacement = Object.assign(new EventEmitter(), {
    owner: async () => 'synthetic-owner',
    frameTooLarge: () => false,
    close: vi.fn(async () => {}),
  });

  await t.select(SMALL);
  const generation = t.session(SMALL)!.generation;

  native.connect.mockResolvedValueOnce(replacement);
  t.ipc.emit(RuntimeEvent.Disconnected);
  expect(t.session(SMALL)!.integrationState).toBe(IntegrationState.Disconnected);
  await t.select(SMALL);

  expect(native.connect).toHaveBeenCalledTimes(2);
  expect(t.session(SMALL)).toMatchObject({ integrationState: IntegrationState.Ready });
  expect(t.session(SMALL)!.generation).not.toBe(generation);
});
