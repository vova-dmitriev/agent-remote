import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchClaudeSession } from '@daemon/sessions/launch/launcher.js';
import { restoreLaunch } from '@daemon/sessions/launch/restore-launch.js';

it('keeps exact arguments and environment in a private one-use payload, never in the terminal command', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'restore-context-')),
    old = process.env.CLAUDE_REMOTE_HOME;

  process.env.CLAUDE_REMOTE_HOME = directory;

  try {
    const context = {
      executable: '/synthetic/claude',
      args: ['--dangerously-skip-permissions', '--model', 'synthetic', '--resume', 'native'],
      env: { SYNTHETIC_SECRET: "quote ' $()\nnewline", PATH: '/synthetic/bin' },
    };

    let script = '';

    const id = await launchClaudeSession({
      directory,
      cwd: directory,
      node: '/node',
      entry: '/entry',
      launchContext: context,
      cmux: {
        windowId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        surfaceId: '33333333-3333-4333-8333-333333333333',
      },
      launchCmux: async (path) => {
        script = await readFile(path, 'utf8');
      },
    });

    const payload = join(directory, 'launchers', id + '.json');

    expect(script).toContain('restore-claude');
    expect(script).not.toContain(context.env.SYNTHETIC_SECRET);
    expect(script).not.toContain('dangerously-skip-permissions');
    expect((await stat(payload)).mode & 0o777).toBe(0o600);
    expect(await restoreLaunch(payload)).toEqual(context);
    await expect(restoreLaunch(payload)).rejects.toThrow('LAUNCH_CONTEXT_UNAVAILABLE');

    await expect(
      launchClaudeSession({
        directory,
        cwd: directory,
        node: '/node',
        entry: '/entry',
        launchContext: context,
        cmux: {
          windowId: '11111111-1111-4111-8111-111111111111',
          workspaceId: '22222222-2222-4222-8222-222222222222',
          surfaceId: '33333333-3333-4333-8333-333333333333',
        },
        launchCmux: async () => {
          throw new Error();
        },
      }),
    ).rejects.toThrow('UNKNOWN_AFTER_WRITE');

    expect((await readdir(join(directory, 'launchers'))).filter((name) => name.endsWith('.json'))).toEqual(
      [],
    );
  } finally {
    if (old === undefined) {
      delete process.env.CLAUDE_REMOTE_HOME;
    } else {
      process.env.CLAUDE_REMOTE_HOME = old;
    }

    await rm(directory, { recursive: true, force: true });
  }
});
