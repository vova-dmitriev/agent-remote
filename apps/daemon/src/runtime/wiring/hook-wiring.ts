import { DesktopOperation } from '../../domain/desktop.js';
import { LegacyHookSocketState } from '../../domain/ipc.js';
import { createDesktopSource, type DesktopBinding } from '../../desktop/adapter.js';
import type { BridgeClient } from '../../desktop/bridge-client.js';
import type { CodexManager } from '../../codex/manager.js';
import type { Monitor } from '../../monitor/monitor.js';
import { MessageTracker, type TranscriptSources } from '../../monitor/history.js';
import type { AdapterRegistry } from '../../adapters/registry.js';
import type { PermissionBroker } from '../../commands/permission-broker.js';
import { startHookServer } from '../../code/hooks/hook-server.js';
import { startLegacyHookSocket } from '../../code/hooks/legacy-socket.js';
import type { DesktopBindingEntry } from '../source-poller.js';

type HookWiringDeps = {
  path: string;
  token: string;
  deviceId: string;
  monitor: Monitor;
  adapters: AdapterRegistry;
  permissions: PermissionBroker;
  inputEnabled: boolean;
  permissionsEnabled: boolean;
  codex: CodexManager;
  desktopBridge: BridgeClient;
  desktopBindings: Map<string, DesktopBindingEntry>;
  readers: TranscriptSources;
  legacyClaudeHooks: boolean;
};

export async function startHookWiring(deps: HookWiringDeps) {
  const { monitor, adapters, desktopBridge, desktopBindings, readers, inputEnabled, permissionsEnabled } =
    deps;

  const listen = (path: string, token: string) =>
    startHookServer({
      path,
      token,
      monitor,
      adapters,
      permissions: deps.permissions,
      inputEnabled,
      permissionsEnabled,
      onCodexConnect: (selection) => deps.codex.connect(selection),
      onDesktopBind: async (mode) => {
        const desktop = (await desktopBridge.request({
          operation: DesktopOperation.Bind,
          mode,
        })) as DesktopBinding;

        const source = createDesktopSource(mode, deps.deviceId, desktop, desktopBridge, {
          inputEnabled,
          permissionsEnabled,
        });

        adapters.register(source.adapter);
        monitor.addDesktop(source.session, source.binding);

        desktopBindings.set(source.session.id, {
          desktop,
          connectorId: source.adapter.descriptor().connectorId,
          tracker: new MessageTracker(),
        });

        return { sessionId: source.session.id, state: source.session.integrationState };
      },
      onTranscript: (sessionId, path) => {
        const session = monitor.session(sessionId);

        if (session) {
          readers.open(sessionId, session.generation, path, session.claudeSessionId ?? undefined);
        }
      },
    });

  const primary = await listen(deps.path, deps.token);

  // Desktop companion only: the CLI daemon owns the legacy path itself.
  const legacy = deps.legacyClaudeHooks
    ? await startLegacyHookSocket(listen)
    : { state: LegacyHookSocketState.Disabled, close: async () => {} };

  if (deps.legacyClaudeHooks && legacy.state !== LegacyHookSocketState.Listening) {
    process.stderr.write(`Legacy Claude hook socket ${legacy.state}.\n`);
  }

  return {
    legacyHookSocket: legacy.state,
    async close() {
      await legacy.close();
      await primary.close();
    },
  };
}
