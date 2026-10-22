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
import { type Monitor } from '../../monitor/monitor.js';
import { type CodexManager } from './codex-manager.js';
import { launchClaudeSession, validateProject } from '../../sessions/launch/launcher.js';
import type { RuntimeProfiles } from './runtime-profiles.js';
import { claudeConfigDirectory } from '../../config.js';
import { claudeConversation } from '../../sessions/projects/recent-folders.js';

/** Where the daemon can start a Claude session in a terminal. */
const CLAUDE_LAUNCH_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['darwin', 'linux']);

type CreateAction = Extract<Command['action'], { type: typeof CommandActionType.CreateSession }>;

interface CreateOptions {
  monitor: Monitor;
  codex: CodexManager;
  profiles?: Pick<RuntimeProfiles, 'prepareExecution'>;
  current?: () => boolean;
  directory: string;
}

/** Starts a session the owner asked for in the app; it heads the session lists until its first message. */
export async function createManagedSession(action: CreateAction, options: CreateOptions): Promise<string> {
  const sessionId = await launchSession(action, options);

  options.monitor.markCreated(sessionId);

  return sessionId;
}

async function launchSession(action: CreateAction, options: CreateOptions): Promise<string> {
  const cwd = await validateProject(action.cwd);

  if (!options.monitor.canCreateSession()) {
    throw new CodedError(ErrorCode.SESSION_QUOTA);
  }

  if (action.provider === AgentProvider.Codex) {
    if (action.resume) {
      return options.codex.resumeThread(action.resume);
    }

    if (!action.execution) {
      return options.codex.createSession(cwd, undefined, action.model);
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

  // Terminal on macOS, tmux on a Linux VM (see launchClaudeSession).
  if (!CLAUDE_LAUNCH_PLATFORMS.has(process.platform)) {
    throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
  }

  let folder = cwd;

  if (action.resume) {
    const conversation = await claudeConversation(claudeConfigDirectory(), action.resume);

    // A session that never got a message has no transcript to continue.
    if (!conversation) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    // Claude continues a conversation only in the folder it ran in.
    folder = conversation.cwd ? await validateProject(conversation.cwd).catch(() => cwd) : cwd;
  }

  const connectorId = await launchClaudeSession({
    directory: options.directory,
    cwd: folder,
    node: process.execPath,
    entry: fileURLToPath(new URL('../../entry/entry.js', import.meta.url)),
    ...(action.model ? { model: action.model } : {}),
    ...(action.resume ? { resumeId: action.resume } : {}),
  });

  return waitManagedSession(options.monitor, connectorId);
}

export async function waitManagedSession(monitor: Monitor, connectorId: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const session = monitor.find(
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
