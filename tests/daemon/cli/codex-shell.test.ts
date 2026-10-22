import { expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node-pty';
import { installCodexShell } from '@daemon/cli/codex-shell.js';

/** Runs a command in an interactive zsh on a terminal, with the synthetic Codex first on the PATH. */
function terminal(dir: string, command: string) {
  return new Promise<string>((resolve, reject) => {
    const shell = spawn('/bin/zsh', ['-ic', command], {
      cwd: dir,
      env: { ...process.env, ZDOTDIR: dir, PATH: join(dir, 'bin') + ':' + process.env.PATH },
    });

    let text = '';

    const timeout = setTimeout(() => {
      shell.kill();
      reject(new Error('SHELL_TIMEOUT'));
    }, 5000);

    shell.onData((data) => {
      text += data;
    });

    shell.onExit(() => {
      clearTimeout(timeout);
      resolve(text);
    });
  });
}

it('runs interactive Codex through Agent Remote and every other Codex command as installed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-shell-'));

  try {
    const remote = join(dir, 'remote.mjs');
    const rc = join(dir, '.zshrc');

    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'bin', 'codex'), '#!/bin/sh\nprintf "NATIVE:%s\\n" "$*"\n');
    await chmod(join(dir, 'bin', 'codex'), 0o700);

    await writeFile(
      remote,
      'console.log("MANAGED:"+process.env.AGENT_REMOTE_CODEX_FALLBACK+JSON.stringify(process.argv.slice(2)));',
    );

    await writeFile(rc, '# Existing configuration\n');

    const options = { directory: dir, rcPath: rc, node: process.execPath, remote };

    await installCodexShell(options);
    const first = await readFile(rc, 'utf8');

    await installCodexShell(options);
    expect(await readFile(rc, 'utf8')).toBe(first);

    expect(await terminal(dir, "codex --model 'synthetic-model' resume safe-id")).toContain(
      'MANAGED:1["codex","--model","synthetic-model","resume","safe-id"]',
    );

    expect(await terminal(dir, 'codex exec synthetic')).toContain('NATIVE:exec synthetic');
    expect(await terminal(dir, 'codex --version')).toContain('NATIVE:--version');
    expect(await terminal(dir, 'codex resume x | cat')).toContain('NATIVE:resume x');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
