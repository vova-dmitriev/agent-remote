import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  symlinkSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { isPrivatePath } from './policy.mjs';
import { assessedFindings } from './semgrep-assessed.mjs';

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
  cpSync(join(repository, '.semgrep'), join(directory, '.semgrep'), { recursive: true });

  return directory;
}

function scan(directory, mode, environment = process.env) {
  return spawnSync(process.execPath, [join(repository, 'scripts/security/check.mjs'), mode], {
    cwd: directory,
    encoding: 'utf8',
    env: environment,
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

const semgrepRules = readFileSync(join(repository, '.semgrep/secobserve-high.yml'), 'utf8');
const unsafeEval = (marker) => `export function ${marker}(input: string) { return eval('1+' + input); }\n`;

const commit = (directory) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@localhost',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--no-verify',
      '-m',
      'base',
    ],
    {
      cwd: directory,
    },
  );

test('vendored Semgrep rules cover only JavaScript and TypeScript', () => {
  const languages = new Set();
  let inLanguages = false;

  for (const line of semgrepRules.split('\n')) {
    const item = /^\s+- ([a-z]+)\s*$/.exec(line);

    if (/^\s+languages:\s*$/.test(line)) {
      inLanguages = true;
    } else if (inLanguages && item) {
      languages.add(item[1]);
    } else {
      inLanguages = false;
    }
  }

  assert.deepEqual([...languages].sort(), ['javascript', 'typescript']);
  assert.match(semgrepRules, /^# Source sha256: [0-9a-f]{64}$/m);
});

test('assessed Semgrep findings name an existing file and a vendored rule', () => {
  for (const entry of assessedFindings) {
    assert.equal(existsSync(join(repository, entry.path)), true, entry.path);
    assert.match(semgrepRules, new RegExp(`- id: ${entry.ruleId}$`, 'm'), entry.ruleId);
  }
});

test('staged High finding is blocked, even with nosemgrep, and no source is printed', () => {
  const directory = fixture();

  writeFileSync(
    join(directory, 'vulnerable.ts'),
    `${unsafeEval('markerAlpha')}${unsafeEval('markerBeta').trimEnd()} // nosemgrep\n`,
  );

  execFileSync('git', ['add', 'vulnerable.ts'], { cwd: directory });
  const result = scan(directory, 'staged');

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /javascript_eval_rule-eval-with-expression: vulnerable\.ts:1\n/);
  assert.match(result.stderr, /javascript_eval_rule-eval-with-expression: vulnerable\.ts:2\n/);

  for (const output of [result.stderr, result.stdout]) {
    assert.equal(/eval\(|marker(Alpha|Beta)|1\+/.test(output), false);
  }
});

test('a finding already in HEAD does not block a commit that leaves it untouched', () => {
  const directory = fixture();

  writeFileSync(join(directory, 'vulnerable.ts'), unsafeEval('markerAlpha'));
  execFileSync('git', ['add', '.'], { cwd: directory });
  commit(directory);
  writeFileSync(join(directory, 'vulnerable.ts'), `${unsafeEval('markerAlpha')}export const harmless = 1;\n`);
  execFileSync('git', ['add', 'vulnerable.ts'], { cwd: directory });
  const result = scan(directory, 'staged');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Semgrep: staged scan passed/);

  writeFileSync(join(directory, 'vulnerable.ts'), `${unsafeEval('markerAlpha')}${unsafeEval('markerNew')}`);
  execFileSync('git', ['add', 'vulnerable.ts'], { cwd: directory });
  const added = scan(directory, 'staged');

  assert.equal(added.status, 1);
  assert.match(added.stderr, /vulnerable\.ts:2\n/);
  assert.equal(added.stderr.includes('vulnerable.ts:1\n'), false);
});

test('worktree scan reports a finding without a baseline', () => {
  const directory = fixture();

  writeFileSync(join(directory, 'vulnerable.ts'), unsafeEval('markerAlpha'));
  const result = scan(directory, 'worktree');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /javascript_eval_rule-eval-with-expression: vulnerable\.ts:1\n/);
});

test('missing Docker fails the Semgrep step instead of skipping it', () => {
  const directory = fixture();
  const tools = mkdtempSync(join(tmpdir(), 'repository-security-tools-'));

  directories.push(tools);

  for (const tool of ['git', 'gitleaks']) {
    const location = execFileSync('which', [tool], { encoding: 'utf8' }).trim();

    symlinkSync(location, join(tools, tool));
  }

  writeFileSync(join(directory, 'clean.ts'), 'export const clean = 1;\n');
  execFileSync('git', ['add', 'clean.ts'], { cwd: directory });
  const result = scan(directory, 'staged', { ...process.env, PATH: tools });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Semgrep requires Docker\. Scan did not run\./);
});

test('an assessed finding passes, but a second finding of the same rule in the same file is blocked', () => {
  const directory = fixture();
  const assessed = 'scripts/smoke-image.ts';

  mkdirSync(join(directory, 'scripts'), { recursive: true });
  cpSync(join(repository, assessed), join(directory, assessed));
  const unchanged = scan(directory, 'worktree');

  assert.equal(unchanged.status, 0, unchanged.stderr);

  const original = readFileSync(join(directory, assessed), 'utf8');

  writeFileSync(
    join(directory, assessed),
    `${original}\nexport async function second(path: string, body: unknown) {\n  return fetch(path, { body: JSON.stringify(body) });\n}\n`,
  );

  const result = scan(directory, 'worktree');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /rules_lgpl_javascript_ssrf_rule-node-ssrf: scripts\/smoke-image\.ts:\d+\n/);
  assert.equal(result.stderr.split('\n').filter((line) => line.startsWith('rules_lgpl')).length, 1);
});

test('staged Semgrep scan inside a hook environment never touches the real repository', () => {
  const directory = fixture();

  const hookEnvironment = {
    ...process.env,
    GIT_DIR: join(directory, '.git'),
    GIT_INDEX_FILE: join(directory, '.git/index'),
  };

  writeFileSync(join(directory, 'clean.ts'), 'export const clean = 1;\n');
  execFileSync('git', ['add', 'clean.ts'], { cwd: directory });
  const result = scan(directory, 'staged', hookEnvironment);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: directory }).status !== 0, true);
  assert.match(execFileSync('git', ['ls-files'], { cwd: directory, encoding: 'utf8' }), /clean\.ts/);
});
