import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('runs the frontend structure check from a relocated project with spaces and URL-special characters', () => {
  const root = mkdtempSync(join(tmpdir(), 'agents remote # unicode-'));

  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'apps/mini-app/src/shared'), { recursive: true });
    const script = join(root, 'scripts/check-frontend-structure.mjs');

    copyFileSync(fileURLToPath(new URL('../scripts/check-frontend-structure.mjs', import.meta.url)), script);

    const output = execFileSync(process.execPath, [script], {
      cwd: tmpdir(),
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(output).toContain('Frontend structure clean');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
