import { expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node-pty';
import { installClaudeShell } from '@daemon/cli/shell-integration.js';

const execute = promisify(execFile);

it('installs an idempotent terminal integration without changing noninteractive Claude commands', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-shell-'));

  try {
    const native = join(dir, 'native-claude');
    const entry = join(dir, 'entry.js');
    const rc = join(dir, '.zshrc');

    await writeFile(rc, '# Existing configuration\n');
    await writeFile(native, '#!/bin/sh\nprintf "NATIVE:%s\\n" "$@"\n');
    await chmod(native, 0o700);
    await writeFile(entry, 'console.log("MANAGED:"+JSON.stringify(process.argv.slice(2)));');
    const options = { directory: dir, rcPath: rc, executable: native, node: process.execPath, entry };

    await installClaudeShell(options);
    const first = await readFile(rc, 'utf8');

    await installClaudeShell(options);
    expect(await readFile(rc, 'utf8')).toBe(first);
    expect(first).toContain('# Existing configuration');

    expect(
      (
        await execute('/bin/zsh', ['-dic', 'claude --version'], {
          env: { ...process.env, HOME: dir, ZDOTDIR: dir },
        })
      ).stdout,
    ).toContain('NATIVE:--version');

    const output = await new Promise<string>((resolve, reject) => {
      const terminal = spawn('/bin/zsh', ['-dic', "claude --model 'synthetic-model' --resume safe-id"], {
        cwd: dir,
        env: { ...process.env, HOME: dir, ZDOTDIR: dir },
      });

      let text = '';

      const timeout = setTimeout(() => {
        terminal.kill();
        reject(new Error('SHELL_TIMEOUT'));
      }, 5000);

      terminal.onData((data) => {
        text += data;
      });

      terminal.onExit(() => {
        clearTimeout(timeout);
        resolve(text);
      });
    });

    expect(output).toContain('MANAGED:["terminal-claude","--model","synthetic-model","--resume","safe-id"]');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
