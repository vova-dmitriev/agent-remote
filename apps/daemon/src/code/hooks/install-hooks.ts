import { DaemonErrorCode } from '../../error-codes.js';
import { shellQuote as quote } from '../../shell/index.js';
import { ClaudeHookEvent, ClaudeHookType } from '../../domain/claude.js';
import { CLAUDE_QUESTION_TIMEOUT_MS } from './input/user-questions.js';
import { HookAgent } from '../../domain/ipc.js';
import { readFile, writeFile, copyFile, rename, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodedError, RULE_ANSWER_TIMEOUT_MS } from '@protocol';

const marker = '--managed-by=claude-remote-v1';

const claudeEvents = [
  ClaudeHookEvent.SessionStart,
  ClaudeHookEvent.SessionEnd,
  ClaudeHookEvent.UserPromptSubmit,
  ClaudeHookEvent.Stop,
  ClaudeHookEvent.PreToolUse,
  ClaudeHookEvent.PostToolUse,
  ClaudeHookEvent.PostToolUseFailure,
  ClaudeHookEvent.PermissionRequest,
  ClaudeHookEvent.Notification,
  ClaudeHookEvent.SubagentStart,
  ClaudeHookEvent.SubagentStop,
];

/**
 * A PreToolUse hook may hold a command while the owner answers a rule stop (10 minutes); Claude runs the command
 * when a hook times out, so the hook's own deadline comes first.
 */
const CLAUDE_HOOK_TIMEOUT_SECONDS: Partial<Record<string, number>> = {
  [ClaudeHookEvent.PermissionRequest]: 60,
  [ClaudeHookEvent.PreToolUse]: Math.max(RULE_ANSWER_TIMEOUT_MS, CLAUDE_QUESTION_TIMEOUT_MS) / 1000 + 60,
};

const CODEX_PRETOOL_TIMEOUT_SECONDS = RULE_ANSWER_TIMEOUT_MS / 1000 + 60;

type Settings = {
  hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
  [key: string]: unknown;
};

async function settings(path: string): Promise<Settings> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

function strip(data: Settings) {
  for (const [event, entries] of Object.entries(data.hooks ?? {})) {
    data.hooks![event] = entries.filter(
      (entry) => !entry.hooks?.some((hook) => hook.command?.includes(marker)),
    );

    if (data.hooks![event]!.length === 0) {
      delete data.hooks![event];
    }
  }

  if (data.hooks && Object.keys(data.hooks).length === 0) {
    delete data.hooks;
  }
}

async function atomic(path: string, data: Settings) {
  const temp = path + '.' + randomUUID();

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
}

/** Codex sessions report through their own integration; its hooks only gate commands against the owner's rules. */
const EVENTS: Record<HookAgent, readonly string[]> = {
  [HookAgent.Claude]: claudeEvents,
  [HookAgent.Codex]: [ClaudeHookEvent.PreToolUse],
};

/** Installs into a hook file in Claude's format: Claude's `settings.json`, or Codex's `hooks.json`. */
export async function installHooks(path: string, entry: string, agent: HookAgent = HookAgent.Claude) {
  if (!isAbsolute(entry)) {
    throw new CodedError(DaemonErrorCode.ABSOLUTE_ENTRY_REQUIRED);
  }

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const data = await settings(path);
  const backup = path + '.claude-remote-backup-' + Date.now() + '-' + randomUUID();

  try {
    await copyFile(path, backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    await writeFile(backup, JSON.stringify(data), { mode: 0o600 });
  }

  strip(data);
  data.hooks ??= {};

  const flag = agent === HookAgent.Claude ? '' : ` --agent=${agent}`;

  for (const event of EVENTS[agent]) {
    const timeout =
      agent === HookAgent.Codex ? CODEX_PRETOOL_TIMEOUT_SECONDS : (CLAUDE_HOOK_TIMEOUT_SECONDS[event] ?? 5);

    (data.hooks[event] ??= []).push({
      hooks: [
        {
          type: ClaudeHookType.Command,
          command: `${quote(process.execPath)} ${quote(entry)} hook${flag} ${marker}`,
          timeout,
        } as { command: string },
      ],
    });
  }

  await atomic(path, data);

  return backup;
}

export async function uninstallHooks(path: string) {
  const data = await settings(path);

  strip(data);
  await atomic(path, data);
}
