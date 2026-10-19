import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { git } from './snapshot.mjs';
import { isAssessed, fingerprint } from './semgrep-assessed.mjs';
import { ScanMode } from './policy.mjs';

// Official image, pinned by digest (semgrep/semgrep:1.181.0). No Python toolchain is installed.
export const SEMGREP_IMAGE =
  'semgrep/semgrep@sha256:81474464c1f07483ba0682a44787fd93c91397419762a04abe2bafaae396304b';
export const RULES_PATH = '.semgrep/secobserve-high.yml';
export const DOCKER_REQUIRED = 'Semgrep requires Docker. Scan did not run.';

const ExitCode = Object.freeze({ Clean: 0, Findings: 1 });
const DOCKER_CHECK_TIMEOUT_MS = 30_000;
const SEMGREP_TIMEOUT_MS = 15 * 60_000;

const semgrepFlags = [
  '--config',
  RULES_PATH,
  '--disable-nosem',
  '--error',
  '--metrics=off',
  '--disable-version-check',
  '--quiet',
  '--skip-unknown-extensions',
  '--exclude',
  '.semgrep',
];

function requireDocker() {
  const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    timeout: DOCKER_CHECK_TIMEOUT_MS,
  });

  if (probe.error || probe.status !== 0) {
    throw new Error(DOCKER_REQUIRED);
  }
}

// Semgrep's baseline compares against a git commit of the scanned directory, so the staged snapshot is a
// small throwaway repository: HEAD versions of the changed files committed, staged versions in the tree.
function stagedRepository(root, directory) {
  // Git hooks export GIT_DIR/GIT_INDEX_FILE; without clearing them these commands would write to the real repository.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );

  const run = (...args) => git(args, directory, { env: environment });

  const changed = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], root)
    .toString()
    .split('\0')
    .filter((file) => file && file !== RULES_PATH && !file.startsWith('.semgrep/'));

  run('init', '--quiet');

  for (const file of changed) {
    const previous = spawnSync('git', ['show', `HEAD:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });

    if (previous.status === 0) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      writeFileSync(join(directory, file), previous.stdout);
    }
  }

  run('add', '--all');

  run(
    '-c',
    'user.name=semgrep',
    '-c',
    'user.email=semgrep@localhost',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--allow-empty',
    '--no-verify',
    '-m',
    'baseline',
  );

  for (const file of changed) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), git(['show', `:${file}`], root));
  }

  mkdirSync(join(directory, '.semgrep'), { recursive: true });
  const staged = spawnSync('git', ['show', `:${RULES_PATH}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });

  writeFileSync(
    join(directory, RULES_PATH),
    staged.status === 0 ? staged.stdout : readFileSync(join(root, RULES_PATH)),
  );

  return changed;
}

function scan(directory, report, extraFlags, targets) {
  const uid = process.getuid?.();
  const user = uid === undefined ? [] : ['--user', `${uid}:${process.getgid()}`];
  const reportDirectory = dirname(report);

  return spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      ...user,
      '-e',
      'HOME=/tmp',
      '-e',
      'GIT_CONFIG_COUNT=1',
      '-e',
      'GIT_CONFIG_KEY_0=safe.directory',
      '-e',
      'GIT_CONFIG_VALUE_0=/src',
      '-v',
      `${directory}:/src`,
      '-v',
      `${reportDirectory}:/out`,
      '-w',
      '/src',
      SEMGREP_IMAGE,
      'semgrep',
      ...semgrepFlags,
      ...extraFlags,
      '--json',
      '--output',
      '/out/semgrep-report.json',
      ...targets,
    ],
    { encoding: 'utf8', timeout: SEMGREP_TIMEOUT_MS },
  );
}

export function runSemgrep(root, mode, temporary) {
  requireDocker();

  const reportDirectory = join(temporary, 'semgrep-report');
  const report = join(reportDirectory, 'semgrep-report.json');

  mkdirSync(reportDirectory);

  let result;
  let scanned;

  if (mode === ScanMode.Staged) {
    const directory = join(temporary, 'semgrep-staged');

    scanned = directory;

    mkdirSync(directory);
    const changed = stagedRepository(root, directory);

    if (changed.length === 0) {
      process.stdout.write('Semgrep: no staged files to scan.\n');

      return;
    }

    // Explicit targets: Semgrep's baseline only inspects the targets it is given.
    result = scan(
      directory,
      report,
      ['--baseline-commit', 'HEAD'],
      changed.map((file) => `./${file}`),
    );
  } else {
    scanned = join(temporary, 'snapshot');
    result = scan(scanned, report, [], ['.']);
  }

  if (result.error || (result.status !== ExitCode.Clean && result.status !== ExitCode.Findings)) {
    // Scanner output can include source excerpts: never print it.
    throw new Error(
      `Semgrep scan did not complete (exit ${result.status ?? 'none'}). Docker or Semgrep failed.`,
    );
  }

  const output = JSON.parse(readFileSync(report, 'utf8'));
  const normalize = (path) => path.replace(/^\.\//, '');

  const findings = output.results
    .map((entry) => ({
      ruleId: entry.check_id.split('.').at(-1),
      path: normalize(entry.path),
      line: entry.start.line,
      fingerprint: fingerprint(
        readFileSync(join(scanned, normalize(entry.path)), 'utf8'),
        entry.start.line,
        entry.end.line,
      ),
    }))
    .filter((finding) => !isAssessed(finding));

  for (const error of output.errors ?? []) {
    const path = Array.isArray(error.path) ? error.path[0] : error.path;

    process.stderr.write(`Semgrep parse warning: ${path ? normalize(path) : 'unknown file'}\n`);
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(`${finding.ruleId}: ${finding.path}:${finding.line}\n`);
    }

    throw new Error(`Semgrep found ${findings.length} new High/Critical findings. Source suppressed.`);
  }

  process.stdout.write(`Semgrep: ${mode} scan passed.\n`);
}
