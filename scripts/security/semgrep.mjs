import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { git } from './snapshot.mjs';
import { fingerprint, newBeyondAssessed, withoutAssessed } from './semgrep-assessed.mjs';
import { ScanMode } from './policy.mjs';

// Official image, pinned by digest (semgrep/semgrep:1.181.0). No Python toolchain is installed.
export const SEMGREP_IMAGE =
  'semgrep/semgrep@sha256:81474464c1f07483ba0682a44787fd93c91397419762a04abe2bafaae396304b';
export const RULES_PATH = '.semgrep/secobserve-high.yml';
export const DOCKER_REQUIRED = 'Semgrep requires Docker. Scan did not run.';
export const IMAGE_UNAVAILABLE = `Semgrep image ${SEMGREP_IMAGE} is not present and could not be pulled. Run "docker pull ${SEMGREP_IMAGE}" with network access. Scan did not run.`;

const ExitCode = Object.freeze({ Clean: 0, Findings: 1 });
const DOCKER_CHECK_TIMEOUT_MS = 30_000;
const IMAGE_PULL_TIMEOUT_MS = 10 * 60_000;
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
  // No per-rule time limit: under host load the default 5 s limit skipped rules on large files (measured on
  // apps/daemon/src/codex/binding/binding.ts at load average 42) and Semgrep reports that only as a warning.
  '--timeout',
  '0',
];

// Semgrep error types. Partial parsing still scans the rest of the file; every other error means a file or rule was
// not scanned, so the gate fails closed.
const SemgrepErrorType = Object.freeze({ PartialParsing: 'PartialParsing' });

function requireDocker() {
  const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    timeout: DOCKER_CHECK_TIMEOUT_MS,
  });

  if (probe.error || probe.status !== 0) {
    throw new Error(DOCKER_REQUIRED);
  }
}

// The scan itself runs with --pull=never and no network; a missing image is pulled once by its digest or the step fails.
function requireImage() {
  const present = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', SEMGREP_IMAGE], {
    stdio: 'ignore',
    timeout: DOCKER_CHECK_TIMEOUT_MS,
  });

  if (present.status === 0) {
    return;
  }

  process.stdout.write(`Semgrep: pulling ${SEMGREP_IMAGE}.\n`);

  const pulled = spawnSync('docker', ['pull', '--quiet', SEMGREP_IMAGE], {
    stdio: 'ignore',
    timeout: IMAGE_PULL_TIMEOUT_MS,
  });

  if (pulled.error || pulled.status !== 0) {
    throw new Error(IMAGE_UNAVAILABLE);
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

// Sources are mounted read-only. Only the throwaway repository's .git is writable (Semgrep's baseline adds a
// temporary git worktree there) and the report directory receives the JSON report.
function scan(directory, report, extraFlags, targets, { writableGit = false } = {}) {
  const uid = process.getuid?.();
  const user = uid === undefined ? [] : ['--user', `${uid}:${process.getgid()}`];
  const reportDirectory = dirname(report);
  const gitMount = writableGit ? ['-v', `${join(directory, '.git')}:/src/.git`] : [];

  return spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--pull=never',
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
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
      `${directory}:/src:ro`,
      ...gitMount,
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

function readReport(result, report, scanned) {
  if (result.error || (result.status !== ExitCode.Clean && result.status !== ExitCode.Findings)) {
    // Scanner output can include source excerpts: never print it.
    throw new Error(
      `Semgrep scan did not complete (exit ${result.status ?? 'none'}). Docker or Semgrep failed.`,
    );
  }

  const output = JSON.parse(readFileSync(report, 'utf8'));
  const normalize = (path) => path.replace(/^\.\//, '');
  const incomplete = [];

  for (const error of output.errors ?? []) {
    const raw = Array.isArray(error.path) ? error.path[0] : error.path;
    const path = raw ? normalize(raw) : 'unknown file';
    const type = Array.isArray(error.type) ? error.type[0] : error.type;

    if (type === SemgrepErrorType.PartialParsing) {
      process.stderr.write(`Semgrep partial parse: ${path}\n`);
    } else {
      incomplete.push(`${path} (${type})`);
    }
  }

  return {
    targets: (output.paths?.scanned ?? []).map(normalize),
    incomplete,
    findings: output.results.map((entry) => ({
      ruleId: entry.check_id.split('.').at(-1),
      path: normalize(entry.path),
      line: entry.start.line,
      fingerprint: fingerprint(
        readFileSync(join(scanned, normalize(entry.path)), 'utf8'),
        entry.start.line,
        entry.end.line,
      ),
    })),
  };
}

function scanSnapshot(snapshot, report) {
  const { incomplete, findings } = readReport(scan(snapshot, report, [], ['.']), report, snapshot);

  return { incomplete, findings: withoutAssessed(findings) };
}

// Staged mode. Semgrep's baseline only inspects explicit targets, and explicit targets bypass its default ignore list
// (tests/, build/, ...), so a plain scan of the staged tree first selects targets exactly as a worktree scan would.
// Only when that scan finds something does a baseline scan against the HEAD versions decide which findings are new.
function scanStaged(root, temporary, report) {
  const directory = join(temporary, 'semgrep-staged');

  mkdirSync(directory);

  if (stagedRepository(root, directory).length === 0) {
    process.stdout.write('Semgrep: no staged files to scan.\n');

    return { incomplete: [], findings: [] };
  }

  const selected = readReport(scan(directory, report, [], ['.']), report, directory);

  if (selected.incomplete.length > 0 || withoutAssessed(selected.findings).length === 0) {
    return { incomplete: selected.incomplete, findings: [] };
  }

  const baseline = readReport(
    scan(
      directory,
      report,
      ['--baseline-commit', 'HEAD'],
      selected.targets.map((file) => `./${file}`),
      { writableGit: true },
    ),
    report,
    directory,
  );

  return {
    incomplete: baseline.incomplete,
    findings: newBeyondAssessed(baseline.findings, selected.findings),
  };
}

export function runSemgrep(root, mode, temporary) {
  requireDocker();
  requireImage();

  const reportDirectory = join(temporary, 'semgrep-report');
  const report = join(reportDirectory, 'semgrep-report.json');

  mkdirSync(reportDirectory);

  const snapshot = join(temporary, 'snapshot');

  const { findings, incomplete } =
    mode === ScanMode.Staged ? scanStaged(root, temporary, report) : scanSnapshot(snapshot, report);

  for (const finding of findings) {
    process.stderr.write(`${finding.ruleId}: ${finding.path}:${finding.line}\n`);
  }

  if (incomplete.length > 0) {
    throw new Error(`Semgrep could not scan: ${incomplete.join(', ')}. Scan incomplete.`);
  }

  if (findings.length > 0) {
    throw new Error(`Semgrep found ${findings.length} new High/Critical findings. Source suppressed.`);
  }

  process.stdout.write(`Semgrep: ${mode} scan passed.\n`);
}
