import {
  ConnectorId,
  EventType,
  TargetKind,
  ConnectorTransport,
  IntegrationState,
  SessionStatus,
  FrameType,
  NativeRestartState,
  historySchema,
  type ServerFrame,
} from '../../../packages/protocol/src/index.js';
import { ModelOrigin, RuntimeEvent } from './domain/runtime.js';
import { DesktopOperation } from './domain/desktop.js';
import {
  SOURCE_POLL_INTERVAL_MS,
  SESSION_ACTIVITY_POLL_INTERVAL_MS,
  NATIVE_PROCESS_POLL_INTERVAL_MS,
  ATTACHMENT_RETRY_INTERVAL_MS,
} from './runtime-timings.js';
import { NativeProcesses } from './sessions/native-process.js';
import { restartClaudeSession } from './sessions/restart-session.js';
import { createManagedSession, waitManagedSession } from './sessions/create-session.js';
import { attachmentSourceCurrent } from './attachments/source-current.js';
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
import { Dispatcher } from './commands/dispatcher.js';
import { MessageTracker, TranscriptSources } from './monitor/history.js';
import { startHookServer } from './code/hook-server.js';
import { RelayClient } from './relay-client.js';
import { loadConfig, localSecret, socketPath, stateDirectory } from './config.js';

export async function startDaemon() {
  const config = await loadConfig(),
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
      reason: 'Для отправки промптов запусти remote claude',
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

  const attachments = new AttachmentService({
    relayUrl: config.relayUrl,
    deviceToken: config.deviceToken,
    directory: stateDirectory(),
    current: (source) => {
      const current = monitor.session(source.id);

      return attachmentSourceCurrent(current, source);
    },
  });

  const nativeProcesses = new NativeProcesses(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'));

  const dispatcher = new Dispatcher({
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
    createSession: (action) => createManagedSession(action, { monitor, codex, directory: stateDirectory() }),
    prepareAttachments: (session, items) => attachments.prepare(session, items),
    recordAttachments: (session, text, items) => attachments.remember(session, text, items),
  });

  dispatcher.setConnection(false);
  const desktopBridge = new BridgeClient();

  const desktopBindings = new Map<
    string,
    { desktop: DesktopBinding; connectorId: string; tracker: MessageTracker }
  >();

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

  const relay = new RelayClient(config.relayUrl, config.deviceToken);
  let online = false;
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

  relay.on(RuntimeEvent.Online, () => {
    online = true;
    dispatcher.setConnection(true);
    snapshot();
    setImmediate(flush);

    void attachments
      .retryExports((source, message) => {
        const current = monitor.session(source.id);

        if (attachmentSourceCurrent(current, source)) {
          monitor.publish(source.id, EventType.Message, message);
        }
      })
      .catch(() => {});
  });

  relay.on(RuntimeEvent.Offline, () => {
    online = false;
    dispatcher.setConnection(false);
    userInputs.clear();

    for (const pending of permissions.pending()) {
      permissions.cancelSession(pending.sessionId, pending.generation);
    }
  });

  relay.on(RuntimeEvent.Frame, (frame: ServerFrame) => {
    if (frame.type === FrameType.HistoryRead) {
      void readers
        .page(frame)
        .then(async (page) => {
          for (const message of page.messages) {
            if (
              !relay.send({
                type: FrameType.HistoryItem,
                requestId: frame.requestId,
                sessionId: frame.sessionId,
                generation: frame.generation,
                message,
              })
            ) {
              return;
            }

            await new Promise<void>((resolve) => setImmediate(resolve));
          }

          relay.send({
            type: FrameType.HistoryDone,
            requestId: frame.requestId,
            sessionId: frame.sessionId,
            generation: frame.generation,
            before: page.before,
            after: page.after,
          });
        })
        .catch(() =>
          relay.send({
            type: FrameType.HistoryDone,
            requestId: frame.requestId,
            sessionId: frame.sessionId,
            generation: frame.generation,
            before: null,
            after: null,
            error: 'HISTORY_RELOAD_FAILED',
          }),
        );
    } else if (frame.type === FrameType.Ack) {
      replay.acknowledge(frame.cursor);
    } else if (frame.type === FrameType.Select) {
      try {
        monitor.select(frame.sessionId);
      } catch {}
    } else if (frame.type === FrameType.Command) {
      void dispatcher.dispatch(frame.command).then((result) => {
        if (result.sessionId) {
          relay.send({ type: FrameType.Snapshot, snapshot: monitor.snapshot(), connectors: adapters.list() });
        }

        relay.send({ type: FrameType.CommandResult, result });
      });
    }
  });

  let exportRetryAt = 0;
  let reading = false;
  let polling: Promise<void> = Promise.resolve();

  const poll = setInterval(() => {
    if (reading) {
      return;
    }

    reading = true;

    polling = (async () => {
      const chosen = monitor.selectedId ? monitor.session(monitor.selectedId) : undefined;

      if (chosen?.target.kind === TargetKind.Cmux) {
        const adapter = adapters.resolve(chosen.target),
          binding = monitor.binding(chosen.id);

        if (adapter instanceof SourceAdapter && binding) {
          try {
            const text = await adapter.readScreen(binding);

            monitor.setTerminal({
              sessionId: chosen.id,
              generation: chosen.generation,
              text,
              capturedAt: Date.now(),
            });
          } catch {
            monitor.invalidate(chosen.target.connectorId);
          }
        }
      }

      for (const [sessionId, item] of desktopBindings) {
        try {
          const result = (await desktopBridge.request({
            operation: DesktopOperation.Read,
            bindingId: item.desktop.bindingId,
          })) as {
            messages: unknown[];
            status: typeof SessionStatus.Idle | typeof SessionStatus.Running;
            canInterrupt: boolean;
            canPrompt: boolean;
          };

          const session = monitor.session(sessionId);

          if (session) {
            session.status = result.status;
            session.lastEventAt = Date.now();
            session.capabilities.prompt = inputEnabled && result.canPrompt;
            session.capabilities.interrupt = inputEnabled && result.canInterrupt;

            for (const value of result.messages) {
              const message = historySchema.safeParse(value);

              if (message.success && item.tracker.accept(message.data)) {
                monitor.publish(sessionId, EventType.Message, message.data);
              }
            }

            snapshot();
          }
        } catch {
          monitor.invalidate(item.connectorId);
          desktopBindings.delete(sessionId);
        }
      }

      for (const [sessionId, reader] of readers.entries()) {
        const session = monitor.session(sessionId);

        if (!session || session.status === SessionStatus.Ended) {
          readers.delete(sessionId);
          continue;
        }

        try {
          const generation = session.generation;
          const modelRevision = monitor.sessionModelRevision(sessionId);
          const messages = await reader.readNext();

          if (
            monitor.session(sessionId)?.generation !== generation ||
            !Array.from(readers.entries()).some(([id, current]) => id === sessionId && current === reader)
          ) {
            continue;
          }

          for (const message of messages) {
            monitor.publish(sessionId, EventType.Message, message);
          }

          monitor.setSessionTitle(sessionId, reader.title);
          monitor.setSessionModel(sessionId, reader.model, ModelOrigin.Transcript, modelRevision);
        } catch {
          if (
            monitor.session(sessionId)?.generation !== session.generation ||
            !readers.delete(sessionId, reader)
          ) {
            continue;
          }

          monitor.publish(sessionId, EventType.Diagnostic, { code: 'TRANSCRIPT_UNAVAILABLE' });
        }
      }

      if (online && Date.now() >= exportRetryAt) {
        exportRetryAt = Date.now() + ATTACHMENT_RETRY_INTERVAL_MS;

        await attachments.retryExports((source, message) => {
          const current = monitor.session(source.id);

          if (attachmentSourceCurrent(current, source)) {
            monitor.publish(source.id, EventType.Message, message);
          }
        });
      }

      store.prune();
      flush();
    })()
      .catch(() => {
        /* Source failures must not terminate the local daemon. */
      })
      .finally(() => {
        reading = false;
      });
  }, SOURCE_POLL_INTERVAL_MS);

  let activityBusy = false;
  let activityTask: Promise<void> = Promise.resolve();

  const refreshActivity = () => {
    if (stopping || activityBusy) {
      return;
    }

    activityBusy = true;

    activityTask = readers
      .refreshActivity()
      .catch(() => {})
      .finally(() => {
        activityBusy = false;
      });
  };

  const activityPoll = setInterval(refreshActivity, SESSION_ACTIVITY_POLL_INTERVAL_MS);

  refreshActivity();
  let inspectingNative = false;

  const refreshNative = async () => {
    if (inspectingNative || stopping || !inputEnabled || process.platform !== 'darwin') {
      return;
    }

    inspectingNative = true;

    try {
      for (const source of monitor
        .snapshot()
        .sessions.filter(
          (session) =>
            session.target.connectorId === ConnectorId.Native &&
            session.target.kind === TargetKind.ClaudeCodeCli,
        )) {
        const inspection = source.claudeSessionId
          ? await nativeProcesses.inspect(source.claudeSessionId, source.cwd)
          : { state: NativeRestartState.Missing };

        if (!stopping) {
          monitor.setNativeRestartState(source.id, source.generation, inspection.state);
        }
      }
    } finally {
      inspectingNative = false;
    }
  };

  const nativePoll = setInterval(() => void refreshNative().catch(() => {}), NATIVE_PROCESS_POLL_INTERVAL_MS);

  void refreshNative().catch(() => {});
  await codex.start();
  relay.connect();

  const close = async () => {
    if (stopping) {
      return;
    }

    stopping = true;
    clearInterval(poll);
    clearInterval(nativePoll);
    clearInterval(activityPoll);
    dispatcher.setConnection(false);
    online = false;
    relay.close();
    permissions.close();
    userInputs.close();
    desktopBridge.close();
    await hookServer.close();
    await polling;
    await activityTask;
    await dispatcher.drain();
    await codex.close();
    await attachments.close();
    await adapters.close();
    store.close();
  };

  relay.on(RuntimeEvent.Revoked, () => {
    void close();
  });

  return { monitor, close };
}
