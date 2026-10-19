import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { git } from './snapshot.mjs';
import {
  ASSESSED_PATH,
  fingerprint,
  newBeyondAssessed,
  parseAssessed,
  withoutAssessed,
} from './semgrep-assessed.mjs';
import { ScanMode } from './policy.mjs';

// Official image, pinned by digest (semgrep/semgrep:1.181.0). No Python toolchain is installed.
export const SEMGREP_IMAGE =
  'semgrep/semgrep@sha256:81474464c1f07483ba0682a44787fd93c91397419762a04abe2bafaae396304b';
export const RULES_PATH = '.semgrep/secobserve-high.yml';
// The gate trusts no rules file from the tree under scan: an intended rules update changes this pin in the same commit.
export const RULES_SHA256 = 'd00951ad8c1ea78be0516db400c88a668e822261f83dc7b3bf6badd3c495f820';
export const DOCKER_REQUIRED = 'Semgrep requires Docker. Scan did not run.';
export const IMAGE_UNAVAILABLE = `Semgrep image ${SEMGREP_IMAGE} is not present and could not be pulled. Run "docker pull ${SEMGREP_IMAGE}" with network access. Scan did not run.`;

const ExitCode = Object.freeze({ Clean: 0, Findings: 1 });
const DOCKER_CHECK_TIMEOUT_MS = 30_000;
const IMAGE_PULL_TIMEOUT_MS = 10 * 60_000;
const SEMGREP_TIMEOUT_MS = 15 * 60_000;
const SEMGREPIGNORE = '.semgrepignore';
const GITIGNORE = '.gitignore';

// Extensions Semgrep 1.181.0 parses as JavaScript/TypeScript. It skips .mts/.cts as unknown, so those are scanned
// under a `.ts` suffix and reported under their own names.
const SCANNED_EXTENSIONS = Object.freeze(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const RENAMED_EXTENSIONS = Object.freeze(['.mts', '.cts']);
const RENAMED_SUFFIX = '.ts';

// The gate owns the ignore list: a generated .semgrepignore at the root of the scan copy replaces Semgrep's built-in
// defaults (which skip test/, tests/, vendor/, build/, dist/, *.min.js, ... at any depth). Only the top-level tests/
// directory and the top-level .semgrep/ rules directory are out of scope; every other JavaScript/TypeScript file must
// appear in the scanned paths, or the scan is incomplete.
const OUT_OF_SCOPE = Object.freeze(['tests/', '.semgrep/']);
const GENERATED_IGNORE = OUT_OF_SCOPE.map((directory) => `/${directory}\n`).join('');

const semgrepFlags = [
  '--config',
  RULES_PATH,
  '--disable-nosem',
  '--error',
  '--metrics=off',
  '--disable-version-check',
  '--quiet',
  '--skip-unknown-extensions',
  // No per-rule time limit: under host load the default 5 s limit skipped rules on large files (measured on
  // apps/daemon/src/codex/binding/binding.ts at load average 42) and Semgrep reports that only as a warning.
  '--timeout',
  '0',
  // No size limit: by default files over 1 MB are skipped silently.
  '--max-target-bytes',
  '0',
  // .gitignore must not hide force-added files.
  '--no-git-ignore',
];

// Semgrep error types. Partial parsing still scans the rest of the file; every other error means a file or rule was
// not scanned, so the gate fails closed.
const SemgrepErrorType = Object.freeze({ PartialParsing: 'PartialParsing' });

const scanName = (file) =>
  RENAMED_EXTENSIONS.some((extension) => file.endsWith(extension)) ? `${file}${RENAMED_SUFFIX}` : file;

// Scan name -> real name for every file of the scan copy; a renamed file may not collide with another file.
function scanNames(files) {
  const present = new Set(files);
  const names = new Map();

  for (const file of files) {
    if (scanName(file) !== file && present.has(scanName(file))) {
      throw new Error(`Cannot scan ${file}: ${scanName(file)} also exists. Scan did not run.`);
    }

    names.set(scanName(file), file);
  }

  return names;
}

const isEligible = (file) =>
  SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension)) &&
  !OUT_OF_SCOPE.some((directory) => file.startsWith(directory));

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

function rejectIgnoreFiles(files) {
  const ignoreFiles = files.filter((file) => basename(file) === SEMGREPIGNORE);

  if (ignoreFiles.length > 0) {
    throw new Error(`Semgrep ignore files are not allowed: ${ignoreFiles.join(', ')}. Scan did not run.`);
  }
}

function verifyRules(directory) {
  const path = join(directory, RULES_PATH);
  const digest = existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'missing';

  if (digest !== RULES_SHA256) {
    throw new Error(
      `${RULES_PATH} does not match the pinned sha256 in scripts/security/semgrep.mjs (${digest}). Scan did not run.`,
    );
  }
}

function treeFiles(directory) {
  return readdirSync(directory, { recursive: true })
    .map((file) => file.split('\\').join('/'))
    .filter((file) => !file.startsWith('.git/') && statSync(join(directory, file)).isFile());
}

// Semgrep's baseline compares against a git commit of the scanned directory, so the staged snapshot is a
// small throwaway repository: HEAD versions of the changed files committed, staged versions in the tree.
// .gitignore files are not copied, git ignores nothing (no global or system config, forced add) and
// Semgrep runs with --no-git-ignore.
function stagedRepository(root, directory) {
  // Git hooks export GIT_DIR/GIT_INDEX_FILE; without clearing them these commands would write to the real repository.
  const environment = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };

  const run = (...args) => git(args, directory, { env: environment });

  rejectIgnoreFiles(git(['ls-files', '-z', '--cached'], root).toString().split('\0').filter(Boolean));

  const changed = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], root)
    .toString()
    .split('\0')
    .filter((file) => file && !file.startsWith('.semgrep/') && basename(file) !== GITIGNORE);

  const names = scanNames(changed);

  run('init', '--quiet');
  writeFileSync(join(directory, SEMGREPIGNORE), GENERATED_IGNORE);

  for (const file of changed) {
    const previous = spawnSync('git', ['show', `HEAD:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });

    if (previous.status === 0) {
      mkdirSync(dirname(join(directory, scanName(file))), { recursive: true });
      writeFileSync(join(directory, scanName(file)), previous.stdout);
    }
  }

  run('add', '--all', '--force');

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
    mkdirSync(dirname(join(directory, scanName(file))), { recursive: true });
    writeFileSync(join(directory, scanName(file)), git(['show', `:${file}`], root));
  }

  const read = (path) => {
    const staged = spawnSync('git', ['show', `:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });

    return staged.status === 0 ? staged.stdout : undefined;
  };

  // Rules and assessments come from the index; the rules file falls back to the working copy and is verified.
  const rules =
    read(RULES_PATH) ??
    (existsSync(join(root, RULES_PATH)) ? readFileSync(join(root, RULES_PATH)) : undefined);

  if (rules !== undefined) {
    mkdirSync(join(directory, '.semgrep'), { recursive: true });
    writeFileSync(join(directory, RULES_PATH), rules);
  }

  return { changed, names, assessed: parseAssessed(read(ASSESSED_PATH)?.toString('utf8')) };
}

// Worktree snapshot: check.mjs exported it already; .mts/.cts files are renamed for scanning.
function prepareSnapshot(snapshot) {
  const files = treeFiles(snapshot);

  rejectIgnoreFiles(files);

  const names = scanNames(files);

  for (const [scanned, file] of names) {
    if (scanned !== file) {
      renameSync(join(snapshot, file), join(snapshot, scanned));
    }
  }

  writeFileSync(join(snapshot, SEMGREPIGNORE), GENERATED_IGNORE);

  const assessedFile = join(snapshot, ASSESSED_PATH);

  return {
    names,
    assessed: parseAssessed(existsSync(assessedFile) ? readFileSync(assessedFile, 'utf8') : undefined),
  };
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

function readReport(result, report, scanned, names) {
  const realName = (file) => names.get(file) ?? file;

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
    const path = raw ? realName(normalize(raw)) : 'unknown file';
    const type = Array.isArray(error.type) ? error.type[0] : error.type;

    if (type === SemgrepErrorType.PartialParsing) {
      process.stderr.write(`Semgrep partial parse: ${path}\n`);
    } else {
      incomplete.push(`Semgrep could not scan: ${path} (${type}).`);
    }
  }

  return {
    targets: (output.paths?.scanned ?? []).map(normalize),
    incomplete,
    findings: output.results.map((entry) => ({
      ruleId: entry.check_id.split('.').at(-1),
      path: realName(normalize(entry.path)),
      line: entry.start.line,
      fingerprint: fingerprint(
        readFileSync(join(scanned, normalize(entry.path)), 'utf8'),
        entry.start.line,
        entry.end.line,
      ),
    })),
  };
}

// Every eligible file must have been scanned: catches size limits, ignore files and anything else that drops targets.
function skippedTargets(directory, scanned, names) {
  const targets = new Set(scanned);
  const skipped = treeFiles(directory).filter((file) => isEligible(file) && !targets.has(file));

  return skipped.length > 0
    ? [`Semgrep skipped eligible files: ${skipped.map((file) => names.get(file) ?? file).join(', ')}.`]
    : [];
}

function scanSnapshot(snapshot, report) {
  const { names, assessed } = prepareSnapshot(snapshot);

  verifyRules(snapshot);

  const { incomplete, findings, targets } = readReport(
    scan(snapshot, report, [], ['.']),
    report,
    snapshot,
    names,
  );

  return {
    incomplete: [...incomplete, ...skippedTargets(snapshot, targets, names)],
    findings: withoutAssessed(findings, assessed),
  };
}

// Staged mode. Semgrep's baseline only inspects explicit targets, and explicit targets bypass ignore files, so a plain
// scan of the staged tree first selects targets exactly as a worktree scan would.
// Only when that scan finds something unassessed does a baseline scan against the HEAD versions decide which findings
// are new.
function scanStaged(root, temporary, report) {
  const directory = join(temporary, 'semgrep-staged');

  mkdirSync(directory);

  const { changed, names, assessed } = stagedRepository(root, directory);

  verifyRules(directory);

  if (changed.length === 0) {
    process.stdout.write('Semgrep: no staged files to scan.\n');

    return { incomplete: [], findings: [] };
  }

  const selected = readReport(scan(directory, report, [], ['.']), report, directory, names);
  const incomplete = [...selected.incomplete, ...skippedTargets(directory, selected.targets, names)];

  if (incomplete.length > 0 || withoutAssessed(selected.findings, assessed).length === 0) {
    return { incomplete, findings: [] };
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
    names,
  );

  const rescanned = new Set(baseline.targets);
  const missing = selected.targets.filter((file) => !rescanned.has(file));

  return {
    incomplete: [
      ...baseline.incomplete,
      ...(missing.length > 0
        ? [
            `Semgrep baseline scan skipped targets: ${missing.map((file) => names.get(file) ?? file).join(', ')}.`,
          ]
        : []),
    ],
    findings: newBeyondAssessed(baseline.findings, selected.findings, assessed),
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
    throw new Error(`${incomplete.join(' ')} Scan incomplete.`);
  }

  if (findings.length > 0) {
    throw new Error(`Semgrep found ${findings.length} new High/Critical findings. Source suppressed.`);
  }

  process.stdout.write(`Semgrep: ${mode} scan passed.\n`);
}
