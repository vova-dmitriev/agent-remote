import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);
const HELPER = 'artifacts/ClaudeRemoteBridge.app/Contents/MacOS/ClaudeBridge';

it.runIf(process.platform === 'darwin')(
  'reads exact argv and environment from a disposable owned native process without shell parsing',
  async (context) => {
    // A build product: `npm run build:helper` (and `validate:commit`, which builds it first) provides it.
    if (!existsSync(HELPER)) {
      context.skip('native helper not built; run npm run build:helper');
    }

    const marker = "space ' quote $()\nnewline";

    const child = spawn(
      process.execPath,
      [
        '-e',
        'setInterval(()=>{},1000)',
        '--',
        '--dangerously-skip-permissions',
        '--model',
        'synthetic-model',
      ],
      { env: { ...process.env, SYNTHETIC_RESTART_CONTEXT: marker }, stdio: 'ignore' },
    );

    try {
      const result = JSON.parse(
        (await execute(HELPER, ['--process-context', String(child.pid)], { maxBuffer: 1048576 })).stdout,
      );

      expect(result.args).toEqual([
        '-e',
        'setInterval(()=>{},1000)',
        '--',
        '--dangerously-skip-permissions',
        '--model',
        'synthetic-model',
      ]);

      expect(result.env.SYNTHETIC_RESTART_CONTEXT).toBe(marker);
    } finally {
      child.kill();
    }
  },
);
