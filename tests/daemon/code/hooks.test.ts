import { afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installHooks, uninstallHooks } from '@daemon/code/hooks/install-hooks.js';
import { parseClaudeArgs } from '@daemon/cli/arguments.js';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('local installation', () => {
  it('backs up and merges its hooks without changing unrelated hook entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hook-install-'));

    dirs.push(dir);
    const path = join(dir, 'settings.json');

    const original = {
      permissions: { allow: ['Read'] },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] },
    };

    await writeFile(path, JSON.stringify(original));
    const backup = await installHooks(path, '/absolute/remote.mjs');

    expect(JSON.parse(await readFile(backup, 'utf8'))).toEqual(original);
    await installHooks(path, '/absolute/remote.mjs');
    const installed = JSON.parse(await readFile(path, 'utf8'));

    expect(installed.hooks.Stop).toHaveLength(2);
    expect(installed.permissions).toEqual(original.permissions);
    await uninstallHooks(path);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(original);
  });

  it('only parses an explicit local resume argument', () => {
    expect(parseClaudeArgs([])).toEqual([]);
    expect(parseClaudeArgs(['--resume', 'session-id'])).toEqual(['--resume', 'session-id']);
    expect(() => parseClaudeArgs(['--dangerously-skip-permissions'])).toThrow('INVALID_CLAUDE_ARGS');
    expect(() => parseClaudeArgs(['--resume', '--eval=bad'])).toThrow('INVALID_CLAUDE_ARGS');

    expect(parseClaudeArgs(['--settings', '/absolute/test-settings.json', '--resume', 'session-id'])).toEqual(
      ['--settings', '/absolute/test-settings.json', '--resume', 'session-id'],
    );

    expect(() => parseClaudeArgs(['--settings', 'relative.json'])).toThrow('INVALID_CLAUDE_ARGS');
  });
});
