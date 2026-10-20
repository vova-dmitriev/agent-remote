import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

    copyFileSync(
      fileURLToPath(new URL('../../../../scripts/check-frontend-structure.mjs', import.meta.url)),
      script,
    );

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

it('rejects shared directories with more than six files', () => {
  const root = mkdtempSync(join(tmpdir(), 'agents remote shared-'));

  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'apps/mini-app/src/shared/api'), { recursive: true });

    copyFileSync(
      fileURLToPath(new URL('../../../../scripts/check-frontend-structure.mjs', import.meta.url)),
      join(root, 'scripts/check-frontend-structure.mjs'),
    );

    for (let index = 0; index < 7; index += 1) {
      writeFileSync(join(root, `apps/mini-app/src/shared/api/file-${index}.ts`), 'export {};\n');
    }

    expect(() =>
      execFileSync(process.execPath, [join(root, 'scripts/check-frontend-structure.mjs')], {
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow(/shared\/api: more than 6 files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('rejects stylesheets outside the Tailwind allowlist', () => {
  const root = mkdtempSync(join(tmpdir(), 'agents remote css-'));
  const app = join(root, 'apps/mini-app/src');

  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(app, 'app/styles'), { recursive: true });
    mkdirSync(join(app, 'features/x/ui'), { recursive: true });

    copyFileSync(
      fileURLToPath(new URL('../../../../scripts/check-frontend-structure.mjs', import.meta.url)),
      join(root, 'scripts/check-frontend-structure.mjs'),
    );

    for (const file of ['globals.css', 'tokens.css', 'markdown.css']) {
      writeFileSync(join(app, 'app/styles', file), '@layer components {}\n');
    }

    writeFileSync(join(app, 'features/x/ui/x.css'), '.x {}\n');
    writeFileSync(join(app, 'features/x/globals.css'), '.x {}\n');
    writeFileSync(join(app, 'features/x/ui/y.scss'), '.y {}\n');

    let stderr = '';

    try {
      execFileSync(process.execPath, [join(root, 'scripts/check-frontend-structure.mjs')], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr);
    }

    expect(stderr).toContain('features/x/ui/x.css: stylesheet outside the allowlist');
    expect(stderr).toContain('features/x/ui/y.scss: stylesheet outside the allowlist');
    expect(stderr).toContain('features/x/globals.css: stylesheet outside the allowlist');
    expect(stderr).not.toContain('app/styles/globals.css');
    expect(stderr).not.toContain('tokens.css');
    expect(stderr).not.toContain('markdown.css');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
