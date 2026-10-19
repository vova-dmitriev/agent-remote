import {
  ConnectorId,
  ConnectorTransport,
  EventType,
  FrameType,
  IntegrationReason,
  IntegrationState,
  type ServerFrame,
  SessionStatus,
  TargetKind,
} from '@protocol';
import { RuntimeEvent } from './domain/runtime.js';
import { DesktopOperation } from './domain/desktop.js';
import { NativeProcesses } from './sessions/native-process.js';
import { restartClaudeSession } from './sessions/restart-session.js';
import { createManagedSession, waitManagedSession } from './sessions/create-session.js';
import { attachmentSourceCurrent } from './attachments/content/source-current.js';
import { AttachmentService } from './attachments/service.js';
import { CodexManager } from './codex/manager.js';
import { BridgeClient } from './desktop/bridge-client.js';
import { createDesktopSource, type DesktopBinding } from './desktop/adapter.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { LocalStore } from './monitor/store.js';
import { Monitor } from './monitor/monitor.js';
import { EventReplay } from './monitor/replay.js';
import { AdapterRegistry, SourceAdapter } from './adapters/registry.js';
import { UserInputBroker } from './commands/user-input-broker.js';
import { PermissionBroker } from './commands/permission-broker.js';
import { DispatchScheduler } from './commands/scheduling/index.js';
import { Dispatcher, type DispatcherOptions } from './commands/dispatcher.js';
import { MessageTracker, TranscriptSources } from './monitor/history.js';
import { startHookServer } from './code/hooks/hook-server.js';
import { RelayClient } from './relay-client.js';
import { RelayFrameRouter } from './runtime/relay-frame-router.js';
import { SourcePoller, type DesktopBindingEntry } from './runtime/source-poller.js';
import { NativeRestartPoller } from './runtime/native-restart-poller.js';
import { localSecret, socketPath, stateDirectory } from './config.js';

import { runtimeConfiguration, browserSettings } from './local/bootstrap/configuration.js';
import { localClientSecret } from './local/bootstrap/identity.js';
import { openLocalServices } from './local/bootstrap/services.js';
import { NoRelay } from './local/bootstrap/no-relay.js';
import { LocalController } from './local/controller/controller.js';
import { RuntimeProfileRelay } from './profiles/runtime/router/relay.js';
import { startLocalServer } from './local/server/server.js';

export async function startDaemon() {
  const config = await runtimeConfiguration(stateDirectory()),
    token = await localSecret();

  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 });

  const inputEnabled = process.env.REMOTE_INPUT_ENABLED === '1',
    permissionsEnabled = process.env.REMOTE_PERMISSIONS_ENABLED === '1';

  const store = new LocalStore(join(stateDirectory(), 'state.sqlite'), config.deviceId),
    adapters = new AdapterRegistry(config.deviceId),
    permissions = new PermissionBroker(),
    userInputs = new UserInputBroker({ changed: () => monitor.emit(RuntimeEvent.Snapshot) });

  adapters.register(
    new SourceAdapter({
      connectorId: ConnectorId.Native,
      kind: TargetKind.ClaudeCodeCli,
      transport: ConnectorTransport.Hooks,
      sourceVersion: 'installed-claude',
      capabilities: {
        observe: true,
        history: true,
        prompt: false,
        interrupt: false,
        permission: permissionsEnabled,
        terminalSnapshot: false,
      },
      state: IntegrationState.Ready,
      reason: IntegrationReason.CliWrapperRequired,
    }),
  );

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

  const attachments = new AttachmentService({
    ...(config.relay ? { relayUrl: config.relay.relayUrl, deviceToken: config.relay.deviceToken } : {}),
    local: localServices.media,
    directory: stateDirectory(),
    current: (source) => {
      const current = monitor.session(source.id);

      return attachmentSourceCurrent(current, source);
    },
  });

  const nativeProcesses = new NativeProcesses(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'));

  const dispatchOptions: DispatcherOptions = {
    scheduler: new DispatchScheduler(),
    deviceId: config.deviceId,
    store,
    monitor,
    adapters,
    permissions,
    userInputs,
    inputEnabled,
    permissionsEnabled,
    restartSession: async (session) => {
      try {
        return await restartClaudeSession(session, {
          directory: stateDirectory(),
          resolve: (id, cwd) => nativeProcesses.resolve(id, cwd),
          capture: (proof) => nativeProcesses.capture(proof),
          stop: (proof) => nativeProcesses.stop(proof),
          stopped: () => monitor.markNativeStopped(session.id, session.generation),
          wait: (connectorId) => waitManagedSession(monitor, connectorId),
        });
      } finally {
        monitor.releaseNativeRestart(session.id);
      }
    },
    createSession: (action, current) =>
      createManagedSession(action, {
        monitor,
        codex,
        profiles: localServices.profiles,
        current,
        directory: stateDirectory(),
      }),
    prepareAttachments: (session, items) => attachments.prepare(session, items),
    recordAttachments: (session, text, items) => attachments.remember(session, text, items),
  };

  const dispatcher = new Dispatcher(dispatchOptions);
  const localDispatcher = new Dispatcher(dispatchOptions);

  dispatcher.setConnection(false);
  const desktopBridge = new BridgeClient();

  const desktopBindings = new Map<string, DesktopBindingEntry>();

  const readers = new TranscriptSources(
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
    async (sessionId, generation, message, media) => {
      const session = monitor.session(sessionId);

      if (!session || session.generation !== generation || !attachmentSourceCurrent(session, session)) {
        return message;
      }

      return attachments.normalize(session, message, media);
    },
    (id, generation, time) => monitor.setSessionActivity(id, generation, time),
    0,
  );

  for (const { session, transcriptPath } of store.nativeSessions()) {
    const restored = monitor.session(session.id);

    if (restored && restored.status !== SessionStatus.Ended && transcriptPath) {
      readers.open(restored.id, restored.generation, transcriptPath, restored.claudeSessionId ?? undefined);
    }
  }

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

  const hookServer = await startHookServer({
    path: socketPath(),
    token,
    monitor,
    adapters,
    permissions,
    inputEnabled,
    permissionsEnabled,
    onCodexConnect: (selection) => codex.connect(selection),
    onDesktopBind: async (mode) => {
      const desktop = (await desktopBridge.request({
        operation: DesktopOperation.Bind,
        mode,
      })) as DesktopBinding;

      const source = createDesktopSource(mode, config.deviceId, desktop, desktopBridge, {
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

  const localController = new LocalController({
    ...localServices,
    deviceId: config.deviceId,
    ownerId: config.ownerId,
    monitor,
    store,
    adapters,
    dispatcher: localDispatcher,
    history: (request) => (readers.has(request.sessionId) ? readers.page(request) : Promise.resolve(null)),
  });

  const localServer = await startLocalServer({
    path: join(stateDirectory(), 'client.sock'),
    capability: await localClientSecret(stateDirectory()),
    controller: localController,
    grants: localServices.grants,
    instanceId: config.instanceId,
    refreshOrigins: async () => (await browserSettings(stateDirectory()))?.origins ?? [],
  });

  const relay = config.relay
    ? new RelayClient(config.relay.relayUrl, config.relay.deviceToken)
    : new NoRelay();

  let online = false;
  let relayEpoch: string | undefined;

  const profileRelay = new RuntimeProfileRelay(
    localServices.profiles,
    () => (online && !stopping ? relayEpoch : undefined),
    (frame) => relay.send(frame),
  );

  let stopping = false;
  let pendingSnapshot = false;

  const snapshot = () => {
    if (!online || pendingSnapshot) {
      return;
    }

    pendingSnapshot = true;

    setImmediate(() => {
      pendingSnapshot = false;

      if (online) {
        const current = monitor.snapshot();

        for (const session of current.sessions) {
          if (readers.has(session.id)) {
            session.capabilities.historyWindow = true;
          }
        }

        relay.send({ type: FrameType.Snapshot, snapshot: current, connectors: adapters.list() });
      }
    });
  };

  monitor.on(RuntimeEvent.Snapshot, snapshot);
  monitor.on(RuntimeEvent.Event, () => snapshot());

  const replay = new EventReplay(
    store,
    () => new Set(monitor.snapshot().sessions.map((session) => session.id)),
    (event) => relay.send({ type: FrameType.Event, event }),
  );

  const flush = () => {
    if (online) {
      replay.flush();
    }
  };

  relay.on(RuntimeEvent.Online, (epoch?: string) => {
    relayEpoch = epoch;
    online = true;
    dispatcher.setConnection(true);
    snapshot();
    setImmediate(flush);

    void retryAttachmentExports().catch(() => {});
  });

  relay.on(RuntimeEvent.Offline, () => {
    relayEpoch = undefined;
    profileRelay.disconnect();
    online = false;
    dispatcher.setConnection(false);

    if (!localController.hasViewers()) {
      userInputs.clear();

      for (const pending of permissions.pending()) {
        permissions.cancelSession(pending.sessionId, pending.generation);
      }
    }
  });

  const retryAttachmentExports = () =>
    attachments.retryExports((source, message) => {
      const current = monitor.session(source.id);

      if (attachmentSourceCurrent(current, source)) {
        monitor.publish(source.id, EventType.Message, message);
      }
    });

  const router = new RelayFrameRouter({
    relay,
    profileRelay,
    readers,
    replay,
    monitor,
    adapters,
    dispatcher,
  });

  relay.on(RuntimeEvent.Frame, (frame: ServerFrame) => void router.route(frame));

  const sourcePoller = new SourcePoller({
    monitor,
    adapters,
    store,
    readers,
    desktopBridge,
    desktopBindings,
    inputEnabled,
    online: () => online,
    stopping: () => stopping,
    snapshot,
    flush,
    retryAttachmentExports,
  });

  const nativePoller = new NativeRestartPoller({
    monitor,
    nativeProcesses,
    inputEnabled,
    stopping: () => stopping,
  });

  sourcePoller.start();
  nativePoller.start();
  await codex.start();
  relay.connect();

  const close = async () => {
    if (stopping) {
      return;
    }

    stopping = true;
    profileRelay.disconnect();
    sourcePoller.stop();
    nativePoller.stop();
    dispatcher.setConnection(false);
    localDispatcher.setConnection(false);
    await localServer.close();
    await localController.close();
    online = false;
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

  return { monitor, close };
}
