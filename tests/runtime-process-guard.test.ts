import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { terminateRuntimeProcesses } from './helpers/runtime-processes.js';

const itOnPosix = it.skipIf(process.platform === 'win32');

itOnPosix('finds and terminates a detached runtime started from a fixture root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-guard-'));

  try {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', join(root, 'marker')], {
      detached: true,
      stdio: 'ignore',
    });

    child.unref();
    await new Promise((resolve) => child.once('spawn', resolve));

    const leaked = await terminateRuntimeProcesses([root]);

    expect(leaked).toHaveLength(1);
    expect(leaked[0]).toContain(`${child.pid} `);
    expect(() => process.kill(child.pid!, 0)).toThrow();
    await expect(terminateRuntimeProcesses([root])).resolves.toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
