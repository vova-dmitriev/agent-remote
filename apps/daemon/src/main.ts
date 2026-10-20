import type { ErrorCode } from '@protocol';
import { RuntimeEvent } from './domain/runtime.js';
import { NativeProcesses } from './sessions/native-process.js';
import { CodexManager } from './runtime/services/codex-manager.js';
import { BridgeClient } from './desktop/bridge-client.js';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { LocalStore } from './monitor/store.js';
import { Monitor } from './monitor/monitor.js';
import { AdapterRegistry } from './adapters/registry.js';
import { UserInputBroker } from './commands/user-input-broker.js';
import { PermissionBroker } from './commands/permission-broker.js';
import { Dispatcher } from './commands/dispatcher.js';
import { RelayClient } from './relay-client.js';
import type { DesktopBindingEntry } from './runtime/source-poller.js';
import { createRelayRuntime } from './runtime/wiring/relay-runtime.js';
import { registerNativeAdapter } from './runtime/wiring/native-adapter.js';
import {
  claudeConfigDirectory,
  createDispatchOptions,
  openTranscriptSources,
} from './runtime/wiring/dispatch-options.js';
import { createAttachments } from './runtime/wiring/attachments.js';
import { startLocalSurface } from './runtime/wiring/local-surface.js';
import { startHookWiring } from './runtime/wiring/hook-wiring.js';
import { localSecret, socketPath, stateDirectory } from './config.js';
import { logDebug } from './diagnostics/log.js';
import { saveRelayStatus } from './diagnostics/relay-status.js';
import { runtimeConfiguration } from './local/bootstrap/configuration.js';
import { openLocalServices } from './runtime/services/local-services.js';
import { NoRelay } from './local/bootstrap/no-relay.js';

export async function startDaemon(options: { legacyClaudeHooks?: boolean } = {}) {
  const config = await runtimeConfiguration(stateDirectory()),
    token = await localSecret();

  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 });

  const inputEnabled = process.env.REMOTE_INPUT_ENABLED === '1',
    permissionsEnabled = process.env.REMOTE_PERMISSIONS_ENABLED === '1';

  const store = new LocalStore(join(stateDirectory(), 'state.sqlite'), config.deviceId),
    adapters = new AdapterRegistry(config.deviceId),
    permissions = new PermissionBroker(),
    userInputs = new UserInputBroker({ changed: () => monitor.emit(RuntimeEvent.Snapshot) });

  registerNativeAdapter(adapters, permissionsEnabled);

  const monitor = new Monitor({
    deviceId: config.deviceId,
    store,
    adapters,
    permissions,
    userInputs,
    allowSessionCreation: inputEnabled,
  });

  const localServices = await openLocalServices(config, stateDirectory(), (id) => monitor.session(id), {
    inputEnabled,
    baseEnvironment: process.env,
    native: { executable: 'codex' },
  });

  const { attachments, retryExports: retryAttachmentExports } = createAttachments(
    config,
    stateDirectory(),
    monitor,
    localServices,
  );

  const nativeProcesses = new NativeProcesses(claudeConfigDirectory());

  const dispatchOptions = createDispatchOptions({
    deviceId: config.deviceId,
    store,
    monitor,
    adapters,
    permissions,
    userInputs,
    inputEnabled,
    permissionsEnabled,
    stateDirectory: stateDirectory(),
    nativeProcesses,
    codex: () => codex,
    profiles: localServices.profiles,
    attachments,
  });

  const dispatcher = new Dispatcher(dispatchOptions);
  const localDispatcher = new Dispatcher(dispatchOptions);

  dispatcher.setConnection(false);
  const desktopBridge = new BridgeClient();
  const desktopBindings = new Map<string, DesktopBindingEntry>();
  const readers = openTranscriptSources(monitor, attachments, store);

  const codex = new CodexManager({
    monitor,
    adapters,
    permissions,
    userInputs,
    inputEnabled,
    permissionsEnabled,
    stateDirectory: stateDirectory(),
    attachments,
  });

  const hookServer = await startHookWiring({
    path: socketPath(),
    token,
    deviceId: config.deviceId,
    monitor,
    adapters,
    permissions,
    inputEnabled,
    permissionsEnabled,
    codex,
    desktopBridge,
    desktopBindings,
    readers,
    legacyClaudeHooks: options.legacyClaudeHooks ?? false,
  });

  const { localController, localServer } = await startLocalSurface({
    config,
    stateDirectory: stateDirectory(),
    localServices,
    monitor,
    store,
    adapters,
    dispatcher: localDispatcher,
    readers,
  }).catch(async (error: unknown) => {
    await hookServer.close();
    throw error;
  });

  const relay = config.relay
    ? new RelayClient(config.relay.relayUrl, config.relay.deviceToken)
    : new NoRelay();

  const { link, sourcePoller, nativePoller } = createRelayRuntime({
    relay,
    monitor,
    store,
    adapters,
    readers,
    dispatcher,
    permissions,
    userInputs,
    localController,
    profiles: localServices.profiles,
    retryAttachmentExports,
    desktopBridge,
    desktopBindings,
    inputEnabled,
    nativeProcesses,
  });

  sourcePoller.start();
  nativePoller.start();
  await codex.start();
  relay.connect();

  const close = async () => {
    if (link.stopping) {
      return;
    }

    link.stopping = true;
    link.profileRelay.disconnect();
    sourcePoller.stop();
    nativePoller.stop();
    dispatcher.setConnection(false);
    localDispatcher.setConnection(false);
    await localServer.close();
    await localController.close();
    link.online = false;
    relay.close();
    permissions.close();
    userInputs.close();
    desktopBridge.close();
    await hookServer.close();
    await sourcePoller.drain();
    await dispatcher.drain();
    await localDispatcher.drain();
    await codex.close();
    await attachments.close();
    await adapters.close();
    store.close();
    localServices.database.close();
  };

  relay.on(RuntimeEvent.Revoked, () => {
    relay.close();
    dispatcher.setConnection(false);
  });

  // The relay client keeps probing on a long interval; `remote status` reports the reason meanwhile.
  relay.on(RuntimeEvent.ProtocolUnsupported, (code: ErrorCode) => {
    dispatcher.setConnection(false);
    process.stderr.write(`${code}\n`);
    void saveRelayStatus(stateDirectory(), code).catch((error: unknown) => logDebug('main', error));
  });

  relay.on(RuntimeEvent.Online, () => {
    void saveRelayStatus(stateDirectory(), null).catch((error: unknown) => logDebug('main', error));
  });

  return {
    monitor,
    close,
    get legacyHookSocket() {
      return hookServer.legacyHookSocket;
    },
  };
}
