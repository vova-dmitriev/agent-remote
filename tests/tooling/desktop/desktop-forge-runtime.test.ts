import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const repository = fileURLToPath(new URL('../../../', import.meta.url));

describe('Desktop Forge build runtime', () => {
  it.runIf(process.platform === 'darwin')(
    'runs installed Forge under the verified Node runtime even when the caller uses obsolete Node',
    async () => {
      const { stdout, stderr } = await run(process.execPath, ['scripts/desktop/make.mjs', '--version'], {
        cwd: repository,
        timeout: 30_000,
      });

      expect(stdout.trim()).toBe('8.0.1');
      expect(stderr).not.toContain('requires Node.js');
    },
    40_000,
  );
});
