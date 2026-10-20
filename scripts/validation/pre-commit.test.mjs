import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(script, validationCommand = 'node --check example.mjs') {
  const root = mkdtempSync(join(tmpdir(), 'strict-pre-commit-test-'));

  directories.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  mkdirSync(join(root, 'scripts'), { recursive: true });

  for (const path of ['.githooks', '.gitleaks.toml', '.semgrep', 'scripts/security', 'scripts/validation']) {
    if (existsSync(join(repository, path))) {
      cpSync(join(repository, path), join(root, path), { recursive: true });
    }
  }

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      type: 'module',
      scripts: { 'validate:commit': validationCommand },
    }),
  );

  writeFileSync(join(root, 'example.mjs'), script);
  execFileSync('git', ['add', '.'], { cwd: root });

  return root;
}

function hook(root) {
  return spawnSync('sh', ['.githooks/pre-commit'], { cwd: root, encoding: 'utf8' });
}

test('pre-commit blocks invalid staged code even when the working copy is fixed', () => {
  const root = fixture('export const broken = ;\n');

  writeFileSync(join(root, 'example.mjs'), 'export const fixed = 1;\n');
  const result = hook(root);

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /SyntaxError/);
});

test('pre-commit validates staged code without rewriting an unstaged edit', () => {
  const root = fixture('export const staged = 1;\n');

  writeFileSync(join(root, 'example.mjs'), 'export const unstaged = ;\n');
  const result = hook(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Staged validation passed/);

  assert.equal(
    execFileSync('git', ['show', ':example.mjs'], { cwd: root, encoding: 'utf8' }),
    'export const staged = 1;\n',
  );
});

test('pre-commit fails closed when the staged validation command is missing', () => {
  const root = fixture('export const valid = 1;\n');

  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  execFileSync('git', ['add', 'package.json'], { cwd: root });
  assert.equal(hook(root).status, 1);
});

test('staged validation resolves Desktop workspace dependencies without staging them', () => {
  const root = fixture(
    `import { createRequire } from 'node:module';
const requireDesktop = createRequire(new URL('./apps/desktop/package.json', import.meta.url));
if (requireDesktop('desktop-fixture') !== 'synthetic') throw new Error('Missing Desktop dependency');
`,
    'node example.mjs',
  );

  const desktop = join(root, 'apps/desktop');
  const dependency = join(desktop, 'node_modules/desktop-fixture');

  mkdirSync(dependency, { recursive: true });
  writeFileSync(join(desktop, 'package.json'), '{"private":true}');
  writeFileSync(join(dependency, 'package.json'), '{"main":"index.cjs"}');
  writeFileSync(join(dependency, 'index.cjs'), "module.exports = 'synthetic';\n");
  execFileSync('git', ['add', 'apps/desktop/package.json'], { cwd: root });

  const result = hook(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(execFileSync('git', ['ls-files', '**/node_modules/**'], { cwd: root }).toString(), '');
});

test('security tests run for a manual validation and for commits that touch the gates, not for others', async () => {
  const { needsSecurityTests } = await import('./security-tests.mjs');

  assert.equal(needsSecurityTests(undefined), true);
  assert.equal(needsSecurityTests('apps/mini-app/src/app.tsx\ntests/e2e/x.spec.ts'), false);
  assert.equal(needsSecurityTests(''), false);

  for (const path of [
    'scripts/security/check.mjs',
    '.semgrep/secobserve-high.yml',
    '.gitleaks.toml',
    '.githooks/pre-commit',
    'package.json',
    'scripts/validation/pre-commit.mjs',
  ]) {
    assert.equal(needsSecurityTests('README.md\n' + path), true, path);
  }
});
