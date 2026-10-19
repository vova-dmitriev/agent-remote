import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ErrorCode } from '@protocol';
import { DaemonErrorCode } from '../apps/daemon/src/error-codes.js';

const filesystem = vi.hoisted(() => ({ failRename: false }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();

  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (filesystem.failRename) {
        throw new Error('SIMULATED_CRASH');
      }

      return actual.rename(...args);
    },
  };
});

import {
  claudeShellDirectory,
  installClaudeShell,
  refreshClaudeShellEntry,
} from '../apps/daemon/src/cli/shell-integration.js';

let home: string;
let source: string;
const environment = { HOME: process.env.HOME, CLAUDE_REMOTE_HOME: process.env.CLAUDE_REMOTE_HOME };

beforeEach(async () => {
  // The real path: on macOS tmpdir() sits under the /var symlink, which the directory check refuses.
  home = await realpath(await mkdtemp(join(tmpdir(), 'claude-shell-refresh-')));
  filesystem.failRename = false;
  source = join(home, 'install/dist/apps/daemon/src');
  process.env.HOME = home;
  delete process.env.CLAUDE_REMOTE_HOME;
  await mkdir(join(source, 'entry'), { recursive: true });
  await mkdir(join(source, 'sessions'), { recursive: true });
  await writeFile(join(source, 'entry/entry.js'), '');
  await writeFile(join(source, 'sessions/entry.js'), '');
});

afterEach(async () => {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  await rm(home, { recursive: true, force: true });
});

const currentEntry = () => join(source, 'entry/entry.js');

async function install(entry: string) {
  const directory = claudeShellDirectory();
  const rcPath = join(home, '.zshrc');

  await installClaudeShell({
    directory,
    rcPath,
    executable: '/usr/local/bin/claude',
    node: '/usr/bin/node',
    entry,
  });

  return { fragment: join(directory, 'claude.zsh'), rcPath };
}

async function expected(entry: string) {
  const other = await mkdtemp(join(tmpdir(), 'claude-shell-expected-'));

  try {
    await installClaudeShell({
      directory: other,
      rcPath: join(other, '.zshrc'),
      executable: '/usr/local/bin/claude',
      node: '/usr/bin/node',
      entry,
    });

    return await readFile(join(other, 'claude.zsh'), 'utf8');
  } finally {
    await rm(other, { recursive: true, force: true });
  }
}

it('resolves the fragment directory under HOME', () => {
  expect(claudeShellDirectory()).toBe(join(home, '.claude-remote'));
});

it('never creates a fragment that was not installed', async () => {
  const result = await refreshClaudeShellEntry({ directory: claudeShellDirectory(), entry: currentEntry() });

  expect(result.changed).toBe(false);
  expect(existsSync(join(home, '.claude-remote'))).toBe(false);
});

it('moves a fragment from the pre-move sessions entry to the current entry', async () => {
  const { fragment, rcPath } = await install(join(source, 'sessions/entry.js'));
  const rc = await readFile(rcPath, 'utf8');

  const result = await refreshClaudeShellEntry({ directory: claudeShellDirectory(), entry: currentEntry() });

  expect(result.changed).toBe(true);
  expect(await readFile(fragment, 'utf8')).toBe(await expected(currentEntry()));
  expect(await readFile(rcPath, 'utf8')).toBe(rc);
});

it('moves a fragment whose entry no longer exists', async () => {
  const { fragment } = await install(join(home, "gone/it's/entry.js"));

  expect(
    (await refreshClaudeShellEntry({ directory: claudeShellDirectory(), entry: currentEntry() })).changed,
  ).toBe(true);

  expect(await readFile(fragment, 'utf8')).toBe(await expected(currentEntry()));
});

it('keeps a fragment that points at another existing install', async () => {
  const other = join(home, 'other/entry.js');

  await mkdir(join(home, 'other'));
  await writeFile(other, '');
  const { fragment } = await install(other);

  expect(
    (await refreshClaudeShellEntry({ directory: claudeShellDirectory(), entry: currentEntry() })).changed,
  ).toBe(false);

  expect(await readFile(fragment, 'utf8')).toBe(await expected(other));
});

it('keeps a current or user-modified fragment', async () => {
  const { fragment } = await install(currentEntry());

  expect(
    (await refreshClaudeShellEntry({ directory: claudeShellDirectory(), entry: currentEntry() })).changed,
  ).toBe(false);

  const modified = (await expected(join(source, 'sessions/entry.js'))) + 'alias extra=true\n';

  await writeFile(fragment, modified);

  expect(
    (await refreshClaudeShellEntry({ directory: claudeShellDirectory(), entry: currentEntry() })).changed,
  ).toBe(false);

  expect(await readFile(fragment, 'utf8')).toBe(modified);
});

it('does not follow a symlinked fragment', async () => {
  const target = join(home, 'target.zsh');

  await writeFile(target, await expected(join(source, 'sessions/entry.js')));
  await mkdir(claudeShellDirectory());
  await symlink(target, join(claudeShellDirectory(), 'claude.zsh'));

  expect(
    (await refreshClaudeShellEntry({ directory: claudeShellDirectory(), entry: currentEntry() })).changed,
  ).toBe(false);

  expect(await readFile(target, 'utf8')).toBe(await expected(join(source, 'sessions/entry.js')));
});

const legacyEntry = () => join(source, 'sessions/entry.js');

const refresh = (directory = claudeShellDirectory()) =>
  refreshClaudeShellEntry({ directory, entry: currentEntry() });

it('refuses a fragment directory reached through a symlinked ancestor', async () => {
  await mkdir(join(home, 'real'));
  await symlink(join(home, 'real'), join(home, 'link'));
  process.env.CLAUDE_REMOTE_HOME = join(home, 'link/.claude-remote');
  const { fragment } = await install(legacyEntry());
  const before = await readFile(fragment, 'utf8');

  await expect(refresh()).rejects.toMatchObject({ code: ErrorCode.LOCAL_RUNTIME_UNTRUSTED });
  expect(await readFile(fragment, 'utf8')).toBe(before);
});

it('refuses a fragment outside the shell integration directory', async () => {
  const elsewhere = join(home, 'elsewhere');

  await installClaudeShell({
    directory: elsewhere,
    rcPath: join(home, '.zshrc'),
    executable: '/usr/local/bin/claude',
    node: '/usr/bin/node',
    entry: legacyEntry(),
  });

  const before = await readFile(join(elsewhere, 'claude.zsh'), 'utf8');

  await expect(refresh(elsewhere)).rejects.toMatchObject({ code: DaemonErrorCode.INVALID_SHELL_PATH });
  expect(await readFile(join(elsewhere, 'claude.zsh'), 'utf8')).toBe(before);
});

it('keeps the original fragment mode', async () => {
  const { fragment } = await install(legacyEntry());

  await chmod(fragment, 0o640);
  expect((await refresh()).changed).toBe(true);
  expect((await stat(fragment)).mode & 0o7777).toBe(0o640);
  expect(await readFile(fragment, 'utf8')).toBe(await expected(currentEntry()));
});

it('leaves the original fragment and no temporary file when publishing fails', async () => {
  const { fragment } = await install(legacyEntry());
  const before = await readFile(fragment, 'utf8');

  filesystem.failRename = true;
  await expect(refresh()).rejects.toThrow('SIMULATED_CRASH');
  expect(await readFile(fragment, 'utf8')).toBe(before);
  expect(await readdir(claudeShellDirectory())).toEqual(['claude.zsh']);
});
