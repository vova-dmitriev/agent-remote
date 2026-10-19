import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchClaudeSession, validateProject } from '../apps/daemon/src/sessions/launch/launcher.js';

it('validates an existing directory and writes a fixed private Terminal launcher with quoted paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'remote-launch-'));

  try {
    const cwd = join(dir, "a'$(touch NO_COMMAND_EXECUTION)");

    await mkdir(cwd);
    expect(await validateProject(cwd)).toBe(await realpath(cwd));
    await expect(validateProject(join(dir, 'missing'))).rejects.toThrow('INVALID_PROJECT');
    const calls: { file: string; args: string[] }[] = [];

    const id = await launchClaudeSession({
      directory: dir,
      cwd,
      node: '/node',
      entry: '/remote.mjs',
      open: async (file, args) => {
        calls.push({ file, args });
      },
    });

    expect(calls[0]?.file).toBe('/usr/bin/open');
    expect(calls[0]?.args.slice(0, 2)).toEqual(['-a', 'Terminal']);
    const script = await readFile(calls[0]!.args[2]!, 'utf8');

    expect(script).toContain("a'\\''$(touch NO_COMMAND_EXECUTION)");
    expect(script).toContain('CLAUDE_REMOTE_LAUNCH_ID=' + id);
    expect(script).toContain("exec '/node' '/remote.mjs' claude");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
