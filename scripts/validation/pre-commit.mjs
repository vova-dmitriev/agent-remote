import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportSnapshot, git } from '../security/snapshot.mjs';
import { ScanMode } from '../security/policy.mjs';

const root = git(['rev-parse', '--show-toplevel'], process.cwd()).toString().trim();
const temporary = mkdtempSync(join(tmpdir(), 'agent-remote-index-'));

try {
  exportSnapshot(root, temporary, ScanMode.Staged);

  for (const relative of ['node_modules', 'apps/mini-app/node_modules']) {
    const source = join(root, relative);

    if (existsSync(source)) {
      const target = join(temporary, relative);

      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(source, target, 'dir');
    }
  }

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

  const result = spawnSync('npm', ['run', 'validate:commit'], {
    cwd: temporary,
    env,
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    throw new Error('Staged validation failed. Commit blocked; working files were not changed.');
  }

  process.stdout.write('Staged validation passed.\n');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
