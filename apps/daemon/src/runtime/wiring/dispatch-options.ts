import { join } from 'node:path';
import { homedir } from 'node:os';
import { SessionStatus } from '@protocol';
import { NativeProcesses } from '../../sessions/native-process.js';
import { restartClaudeSession } from '../../sessions/restart-session.js';
import { createManagedSession, waitManagedSession } from '../services/create-session.js';
import { TranscriptSources } from '../../monitor/history.js';
import { attachmentSourceCurrent } from '../../attachments/content/source-current.js';
import type { AttachmentService } from '../../attachments/service.js';
import type { CodexManager } from '../services/codex-manager.js';
import type { AdapterRegistry } from '../../adapters/registry.js';
import type { PermissionBroker } from '../../commands/permission-broker.js';
import type { UserInputBroker } from '../../commands/user-input-broker.js';
import type { LocalStore } from '../../monitor/store.js';
import type { Monitor } from '../../monitor/monitor.js';
import { DispatchScheduler } from '../../commands/scheduling/index.js';
import type { DispatcherOptions } from '../../commands/dispatcher.js';
import type { LocalServices } from '../services/local-services.js';

export const claudeConfigDirectory = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');

type DispatchOptionsDeps = {
  deviceId: string;
  store: LocalStore;
  monitor: Monitor;
  adapters: AdapterRegistry;
  permissions: PermissionBroker;
  userInputs: UserInputBroker;
  inputEnabled: boolean;
  permissionsEnabled: boolean;
  stateDirectory: string;
  nativeProcesses: NativeProcesses;
  codex: () => CodexManager;
  profiles: LocalServices['profiles'];
  attachments: AttachmentService;
};

export function createDispatchOptions(deps: DispatchOptionsDeps): DispatcherOptions {
  const { monitor, nativeProcesses, attachments } = deps;

  return {
    scheduler: new DispatchScheduler(),
    deviceId: deps.deviceId,
    store: deps.store,
    monitor,
    adapters: deps.adapters,
    permissions: deps.permissions,
    userInputs: deps.userInputs,
    inputEnabled: deps.inputEnabled,
    permissionsEnabled: deps.permissionsEnabled,
    restartSession: async (session) => {
      try {
        return await restartClaudeSession(session, {
          directory: deps.stateDirectory,
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
        codex: deps.codex(),
        profiles: deps.profiles,
        current,
        directory: deps.stateDirectory,
      }),
    prepareAttachments: (session, items) => attachments.prepare(session, items),
    recordAttachments: (session, text, items) => attachments.remember(session, text, items),
  };
}

export function openTranscriptSources(monitor: Monitor, attachments: AttachmentService, store: LocalStore) {
  const readers = new TranscriptSources(
    claudeConfigDirectory(),
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

  return readers;
}
