import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BindingState, HistoryDirection, IntegrationState, TargetKind } from '@protocol';
import { RuntimeEvent } from '../../../../apps/daemon/src/domain/runtime.js';
import {
  CodexItemType,
  CodexMethod,
  CodexRuntimeStatus,
} from '../../../../apps/daemon/src/domain/codex/codex.js';
import { CodexManager } from '../../../../apps/daemon/src/runtime/services/codex-manager.js';
import { LocalStore } from '../../../../apps/daemon/src/monitor/store.js';
import { Monitor } from '../../../../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry } from '../../../../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../../../../apps/daemon/src/commands/permission-broker.js';

const native = vi.hoisted(() => ({ connect: vi.fn(), attach: vi.fn() }));

vi.mock('../../../../apps/daemon/src/codex/rpc/transport.js', () => ({
  connectCodexSocket: async () => {
    throw new Error('Synthetic unavailable endpoint');
  },
}));

vi.mock('../../../../apps/daemon/src/codex/desktop/desktop-ipc.js', () => ({
  DesktopIpcClient: { connect: native.connect },
}));

vi.mock('../../../../apps/daemon/src/codex/desktop/desktop-client.js', () => ({
  DesktopCodexClient: { attach: native.attach },
}));

function threadClient() {
  return Object.assign(new EventEmitter(), {
    request: vi.fn(async (method: string) => {
      if (method === CodexMethod.ThreadLoadedList) {
        return { data: ['synthetic-thread'] };
      }

      if (method === CodexMethod.ThreadRead || method === CodexMethod.ThreadResume) {
        return {
          thread: {
            id: 'synthetic-thread',
            canAcceptDirectInput: true,
            status: { type: CodexRuntimeStatus.Idle },
            turns: [],
          },
        };
      }

      if (method === CodexMethod.ThreadItemsList) {
        return {
          data: [
            {
              turnId: 'synthetic-turn',
              occurredAt: 1_700_000_000_000,
              item: {
                id: 'synthetic-message',
                type: CodexItemType.AgentMessage,
                text: 'Recovered synthetic history',
              },
            },
          ],
          nextCursor: null,
        };
      }

      return { data: [], nextCursor: null };
    }),
    respond() {},
    close: vi.fn(async () => {}),
  });
}

it('reattaches a disconnected desktop thread even when its shared IPC connection stays online', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-thread-reconnect-'));

  const ipc = Object.assign(new EventEmitter(), {
    owner: async () => 'synthetic-owner',
    frameTooLarge: () => false,
    close: vi.fn(async () => {}),
  });

  const clients = [threadClient(), threadClient()];

  native.connect.mockResolvedValue(ipc);
  native.attach.mockResolvedValueOnce(clients[0]).mockResolvedValueOnce(clients[1]);
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

  const selection = {
    kind: TargetKind.CodexDesktop,
    socketPath: join(directory, 'ipc.sock'),
    threadId: 'synthetic-thread',
  };

  try {
    await manager.connect(selection);
    const before = monitor.snapshot().sessions[0]!;
    const generation = before.generation;

    clients[0]!.emit(RuntimeEvent.Disconnected);
    expect(monitor.session(before.id)!.integrationState).toBe(IntegrationState.Disconnected);
    expect(monitor.session(before.id)!.capabilities.prompt).toBe(false);
    await manager.start();
    await vi.waitFor(() => expect(monitor.session(before.id)!.integrationState).toBe(IntegrationState.Ready));
    const restored = monitor.snapshot().sessions[0]!;

    expect(native.attach).toHaveBeenCalledTimes(2);
    expect(restored.id).toBe(before.id);
    expect(restored.generation).not.toBe(generation);
    expect(restored.binding).toBe(BindingState.Verified);
    expect(restored.integrationState).toBe(IntegrationState.Ready);
    expect(restored.capabilities.prompt).toBe(true);
    expect(clients[1]!.request).toHaveBeenCalledWith(CodexMethod.ThreadItemsList, expect.any(Object));

    expect(
      clients[1]!.request.mock.calls.some(
        ([method]) => method === CodexMethod.TurnStart || method === CodexMethod.TurnSteer,
      ),
    ).toBe(false);

    expect(
      JSON.stringify(store.historyPage({ sessionId: restored.id, direction: HistoryDirection.Latest })),
    ).toContain('Recovered synthetic history');

    expect(clients[0]!.close).toHaveBeenCalledTimes(1);
    expect(ipc.close).not.toHaveBeenCalled();
  } finally {
    await manager.close();
    permissions.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
