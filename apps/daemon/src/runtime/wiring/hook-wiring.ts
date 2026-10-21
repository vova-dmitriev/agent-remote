import { DesktopOperation } from '../../domain/desktop.js';
import { LegacyHookSocketState } from '../../domain/ipc.js';
import { createDesktopSource, type DesktopBinding } from '../../desktop/adapter.js';
import type { BridgeClient } from '../../desktop/bridge-client.js';
import type { CodexManager } from '../services/codex-manager.js';
import type { Monitor } from '../../monitor/monitor.js';
import { MessageTracker, type TranscriptSources } from '../../monitor/history.js';
import type { AdapterRegistry } from '../../adapters/registry.js';
import type { PermissionBroker } from '../../commands/permission-broker.js';
import type { UserInputBroker } from '../../commands/user-input-broker.js';
import { hasErrorCode } from '@protocol';
import { DaemonErrorCode } from '../../error-codes.js';
import { startHookServer, type HookSocketOptions } from '../../code/hooks/hook-server.js';
import { RuleGuard } from '../../rules/check.js';
import { RulesStore } from '../../rules/store.js';
import { requestHookSocketRelease, startLegacyHookSocket } from '../../code/hooks/legacy-socket.js';
import { removeHookPeer, writeHookPeer } from '../../code/hooks/hook-delivery.js';
import { dirname } from 'node:path';
import type { DesktopBindingEntry } from '../source-poller.js';
import type { LocalStore } from '../../monitor/store.js';
import type { NativeProcesses } from '../../sessions/native-process.js';
import { cmuxAttacher } from '../../cmux/attach.js';
import { discoverCmuxSessions, restoreCmuxSessions } from '../../cmux/restore.js';
import { NativeRestartState } from '@protocol';
import { logDebug } from '../../diagnostics/log.js';

type HookWiringDeps = {
  path: string;
  token: string;
  deviceId: string;
  monitor: Monitor;
  adapters: AdapterRegistry;
  permissions: PermissionBroker;
  userInputs?: UserInputBroker;
  inputEnabled: boolean;
  permissionsEnabled: boolean;
  codex: CodexManager;
  desktopBridge: BridgeClient;
  desktopBindings: Map<string, DesktopBindingEntry>;
  readers: TranscriptSources;
  legacyClaudeHooks: boolean;
  store: Pick<LocalStore, 'cmuxSessions'>;
  nativeProcesses: NativeProcesses;
};

export async function startHookWiring(deps: HookWiringDeps) {
  const { monitor, adapters, desktopBridge, desktopBindings, readers, inputEnabled, permissionsEnabled } =
    deps;

  const attachCmux = cmuxAttacher({ adapters, inputEnabled, permissionsEnabled });

  const onTranscript = (sessionId: string, path: string) => {
    const session = monitor.session(sessionId);

    if (session) {
      readers.open(sessionId, session.generation, path, session.claudeSessionId ?? undefined);
    }
  };

  const listen = (socket: HookSocketOptions) =>
    startHookServer({
      ...socket,
      monitor,
      adapters,
      permissions: deps.permissions,
      ...(deps.userInputs ? { userInputs: deps.userInputs } : {}),
      rules: new RuleGuard({ store: new RulesStore(), permissions: deps.permissions, monitor }),
      inputEnabled,
      permissionsEnabled,
      attachCmux,
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
      onTranscript,
    });

  // The CLI daemon has precedence on its own path: a desktop companion's legacy listener yields it.
  const listenPrimary = async () => {
    try {
      return await listen({ path: deps.path, token: deps.token });
    } catch (error) {
      if (!hasErrorCode(error, DaemonErrorCode.DAEMON_ALREADY_RUNNING)) {
        throw error;
      }

      await requestHookSocketRelease(deps.path, deps.token);

      return listen({ path: deps.path, token: deps.token });
    }
  };

  const primary = await listenPrimary();

  // In the background: each surface is confirmed through the cmux CLI. Saved sessions keep their ids and titles;
  // the rest of the Claude processes running in cmux are found after them.
  const processes = deps.nativeProcesses;

  void restoreCmuxSessions({
    saved: deps.store.cmuxSessions(),
    attach: attachCmux,
    running: async (id) => (await processes.inspect(id)).state === NativeRestartState.Available,
    monitor,
    onTranscript,
  })
    .then(() =>
      discoverCmuxSessions({
        deviceId: deps.deviceId,
        live: () => processes.live(),
        surface: (pid) => processes.cmuxSurface(pid),
        transcript: (id) => processes.transcript(id),
        attach: attachCmux,
        monitor,
        onTranscript,
      }),
    )
    .catch((error: unknown) => logDebug('runtime/wiring/hook-wiring', error));

  // Desktop companion only: the CLI daemon owns the legacy path itself.
  // While the CLI daemon holds the legacy path, `remote hook` also delivers to this companion's own socket.
  const peer = (state: LegacyHookSocketState) =>
    void (
      state === LegacyHookSocketState.Listening ? removeHookPeer() : writeHookPeer(dirname(deps.path))
    ).catch((error: unknown) => logDebug('runtime/wiring/hook-wiring', error));

  const legacy = deps.legacyClaudeHooks
    ? await startLegacyHookSocket(listen, { onState: peer })
    : { state: LegacyHookSocketState.Disabled, close: async () => {} };

  if (deps.legacyClaudeHooks && legacy.state !== LegacyHookSocketState.Listening) {
    process.stderr.write(`Legacy Claude hook socket ${legacy.state}.\n`);
  }

  return {
    get legacyHookSocket() {
      return legacy.state;
    },
    async close() {
      await legacy.close();

      if (deps.legacyClaudeHooks) {
        await removeHookPeer().catch((error: unknown) => logDebug('runtime/wiring/hook-wiring', error));
      }

      await primary.close();
    },
  };
}
