import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  claudeShellDirectory,
  installClaudeShell,
  refreshClaudeShellEntry,
} from '../apps/daemon/src/cli/shell-integration.js';

let home: string;
let source: string;
const environment = { HOME: process.env.HOME, CLAUDE_REMOTE_HOME: process.env.CLAUDE_REMOTE_HOME };

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'claude-shell-refresh-'));
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
