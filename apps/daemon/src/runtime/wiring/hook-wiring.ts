import { DesktopOperation } from '../../domain/desktop.js';
import { createDesktopSource, type DesktopBinding } from '../../desktop/adapter.js';
import type { BridgeClient } from '../../desktop/bridge-client.js';
import type { CodexManager } from '../../codex/manager.js';
import type { Monitor } from '../../monitor/monitor.js';
import { MessageTracker, type TranscriptSources } from '../../monitor/history.js';
import type { AdapterRegistry } from '../../adapters/registry.js';
import type { PermissionBroker } from '../../commands/permission-broker.js';
import { startHookServer } from '../../code/hooks/hook-server.js';
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
};

export function startHookWiring(deps: HookWiringDeps) {
  const { monitor, adapters, desktopBridge, desktopBindings, readers, inputEnabled, permissionsEnabled } =
    deps;

  return startHookServer({
    path: deps.path,
    token: deps.token,
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
}
