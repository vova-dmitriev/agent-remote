import { ClaudeHookEvent, ClaudeHookType } from '../domain/claude.js';
import { readFile, writeFile, copyFile, rename, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const marker = '--managed-by=claude-remote-v1';

const events = [
  ClaudeHookEvent.SessionStart,
  ClaudeHookEvent.SessionEnd,
  ClaudeHookEvent.UserPromptSubmit,
  ClaudeHookEvent.Stop,
  ClaudeHookEvent.PreToolUse,
  ClaudeHookEvent.PostToolUse,
  ClaudeHookEvent.PostToolUseFailure,
  ClaudeHookEvent.PermissionRequest,
  ClaudeHookEvent.SubagentStart,
  ClaudeHookEvent.SubagentStop,
];

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

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export async function installHooks(path: string, entry: string) {
  if (!isAbsolute(entry)) {
    throw new Error('ABSOLUTE_ENTRY_REQUIRED');
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

  for (const event of events) {
    (data.hooks[event] ??= []).push({
      hooks: [
        {
          type: ClaudeHookType.Command,
          command: `${quote(process.execPath)} ${quote(entry)} hook ${marker}`,
          timeout: event === ClaudeHookEvent.PermissionRequest ? 60 : 5,
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
