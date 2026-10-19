import {
  AgentProvider,
  BindingState,
  CodedError,
  type Command,
  CommandActionType,
  ErrorCode,
  IntegrationState,
} from '@protocol';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { type Monitor } from '../monitor/monitor.js';
import { type CodexManager } from '../codex/manager.js';
import { launchClaudeSession, validateProject } from './launch/launcher.js';
import type { RuntimeProfiles } from '../profiles/runtime/service.js';

export async function createManagedSession(
  action: Extract<Command['action'], { type: typeof CommandActionType.CreateSession }>,
  options: {
    monitor: Monitor;
    codex: CodexManager;
    profiles?: Pick<RuntimeProfiles, 'prepareExecution'>;
    current?: () => boolean;
    directory: string;
  },
): Promise<string> {
  const cwd = await validateProject(action.cwd);

  if (!options.monitor.canCreateSession()) {
    throw new CodedError(ErrorCode.SESSION_QUOTA);
  }

  if (action.provider === AgentProvider.Codex) {
    if (!action.execution) {
      return options.codex.createSession(cwd);
    }

    if (!options.profiles) {
      throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    const launch = await options.profiles.prepareExecution(
      action.execution.selection,
      action.execution.expectedVersion,
      options.current,
    );

    return options.codex.createSession(cwd, launch);
  }

  if (action.execution) {
    throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
  }

  if (process.platform !== 'darwin') {
    throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
  }

  const connectorId = await launchClaudeSession({
    directory: options.directory,
    cwd,
    node: process.execPath,
    entry: fileURLToPath(new URL('./entry.js', import.meta.url)),
  });

  return waitManagedSession(options.monitor, connectorId);
}

export async function waitManagedSession(monitor: Monitor, connectorId: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const session = monitor
      .snapshot()
      .sessions.find(
        (session) =>
          session.target.connectorId === connectorId &&
          session.binding === BindingState.Verified &&
          session.integrationState === IntegrationState.Ready,
      );

    if (session) {
      return session.id;
    }

    await delay(200);
  }

  throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
}
