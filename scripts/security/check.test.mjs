import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { isPrivatePath } from './policy.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'repository-security-test-'));

  directories.push(directory);
  execFileSync('git', ['init', '--quiet', directory]);
  cpSync(join(repository, '.gitleaks.toml'), join(directory, '.gitleaks.toml'));

  return directory;
}

function scan(directory, mode) {
  return spawnSync(process.execPath, [join(repository, 'scripts/security/check.mjs'), mode], {
    cwd: directory,
    encoding: 'utf8',
  });
}

test('private/generated paths are denied, curated screenshots and environment template are allowed', () => {
  for (const file of [
    '.env',
    '.env.production',
    '.local-data/chat.json',
    '.worktrees/subscriptions/.env',
    'output/image.png',
    'nested/tunnel-credentials.json',
    'secret.pem',
    'test-results/trace.zip',
    'session.jsonl',
    'apps/desktop/out/agent-remote-desktop-darwin-arm64/Agent Remote.app/Contents/Info.plist',
    'copied/Agent Remote.app/Contents/Resources/app.asar',
    'build/output.js',
    'scripts/build/.env.mjs',
    'scripts/build/.env.production.ts',
    'scripts/build/dump.db-x.js',
    'scripts/build/nested/build/output.js',
  ]) {
    assert.equal(isPrivatePath(file), true, file);
  }

  for (const file of [
    '.env.example',
    'docs/screenshots/sessions.png',
    'apps/mini-app/src/index.ts',
    'scripts/build/node.mjs',
    'scripts/build/rewrite-aliases.d.mts',
  ]) {
    assert.equal(isPrivatePath(file), false, file);
  }
});

test('force-added Desktop build output is blocked by staged path policy', () => {
  const directory = fixture();
  const generated = 'apps/desktop/out/package/Info.plist';

  mkdirSync(join(directory, 'apps/desktop/out/package'), { recursive: true });
  writeFileSync(join(directory, '.gitignore'), 'apps/desktop/out/\n');
  writeFileSync(join(directory, generated), 'synthetic generated output');
  execFileSync('git', ['add', '--force', generated], { cwd: directory });
  const result = scan(directory, 'staged');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Private\/generated path/);
});

test('staged secret is blocked even after the working copy has been sanitized; values are suppressed', () => {
  const directory = fixture();
  const secret = `${'1234567890'}:${'A'.repeat(35)}`;

  writeFileSync(join(directory, 'config.txt'), `BOT_TOKEN=${secret}\n`);
  execFileSync('git', ['add', 'config.txt'], { cwd: directory });
  writeFileSync(join(directory, 'config.txt'), 'BOT_TOKEN=\n');
  const result = scan(directory, 'staged');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /telegram-bot-token:.*config.txt:1/);
  assert.equal(result.stderr.includes(secret), false);
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(scan(directory, 'worktree').status, 0);
});

test('force-added private files fail regardless of ignore rules', () => {
  const directory = fixture();

  writeFileSync(join(directory, '.gitignore'), '.env\n');
  writeFileSync(join(directory, '.env'), 'BOT_TOKEN=\n');
  execFileSync('git', ['add', '--force', '.env'], { cwd: directory });
  const result = scan(directory, 'staged');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Private\/generated path/);
});

test('worktree scan includes untracked candidates but excludes ignored private files', () => {
  const directory = fixture();

  writeFileSync(join(directory, '.gitignore'), '.env\n');
  writeFileSync(join(directory, '.env'), `BOT_TOKEN=${'1234567890'}:${'B'.repeat(35)}\n`);
  writeFileSync(join(directory, 'example.md'), '# Public example\n');
  assert.equal(scan(directory, 'worktree').status, 0);
  writeFileSync(join(directory, 'example.md'), `BOT_TOKEN=${'1234567890'}:${'C'.repeat(35)}\n`);
  assert.equal(scan(directory, 'worktree').status, 1);
});

test('installed pre-commit hook rejects staged secrets without creating a commit', () => {
  const directory = fixture();

  mkdirSync(join(directory, 'scripts'), { recursive: true });
  cpSync(join(repository, 'scripts/security'), join(directory, 'scripts/security'), { recursive: true });
  cpSync(join(repository, '.githooks'), join(directory, '.githooks'), { recursive: true });
  writeFileSync(join(directory, 'config.txt'), `BOT_TOKEN=${'1234567890'}:${'D'.repeat(35)}\n`);
  execFileSync('git', ['add', 'config.txt'], { cwd: directory });
  const before = readFileSync(join(directory, '.git/HEAD'), 'utf8');
  const result = spawnSync('sh', ['.githooks/pre-commit'], { cwd: directory, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /telegram-bot-token/);
  assert.equal(readFileSync(join(directory, '.git/HEAD'), 'utf8'), before);
  assert.equal(scan(directory, 'history').status, 0);
});
