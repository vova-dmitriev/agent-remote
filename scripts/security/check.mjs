import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exportSnapshot, git } from './snapshot.mjs';
import { isPrivatePath, ScanMode } from './policy.mjs';

const mode = process.argv[2] ?? ScanMode.Worktree;
const root = git(['rev-parse', '--show-toplevel'], process.cwd()).toString().trim();
const temporary = mkdtempSync(join(tmpdir(), 'agent-remote-security-'));

function check() {
  if (!Object.values(ScanMode).includes(mode)) {
    throw new Error('Expected worktree, staged or history mode.');
  }

  const report = join(temporary, 'report.json');
  const args = ['dir'];

  if (mode === ScanMode.History) {
    const refs = git(['rev-list', '--all', '--count'], root).toString().trim();

    if (refs === '0') {
      process.stdout.write('Security: no commits to scan.\n');

      return;
    }

    const historyOptions = ['--all', '--full-history', '--diff-merges=separate'];

    const paths = git(['log', ...historyOptions, '--pretty=format:', '--name-only', '-z'], root)
      .toString()
      .split('\0')
      .map((file) => file.replace(/^\n+/, ''))
      .filter(Boolean);

    for (const file of paths) {
      if (isPrivatePath(file)) {
        throw new Error(`Private/generated path exists in history: ${file}`);
      }
    }

    args.splice(0, 1, 'git', `--log-opts=${historyOptions.join(' ')}`, root);
  } else {
    const snapshot = join(temporary, 'snapshot');

    mkdirSync(snapshot);
    const count = exportSnapshot(root, snapshot, mode);

    process.stdout.write(`Security: scanning ${count} ${mode} files.\n`);
    args.push(snapshot);
  }

  args.push(
    '--config',
    resolve(root, '.gitleaks.toml'),
    '--redact=100',
    '--no-banner',
    '--no-color',
    '--ignore-gitleaks-allow',
    '--gitleaks-ignore-path',
    temporary,
    '--report-format',
    'json',
    '--report-path',
    report,
  );

  const result = spawnSync('gitleaks', args, { cwd: temporary, encoding: 'utf8' });

  if (result.error) {
    throw new Error('Gitleaks is required (brew install gitleaks). Scan did not run.');
  }

  if (result.status !== 0) {
    let findings = [];

    try {
      findings = JSON.parse(readFileSync(report, 'utf8'));
    } catch {
      // Never print scanner output: it can contain credentials or private content.
    }

    for (const finding of findings) {
      const file = finding.File.replace(`${temporary}/snapshot/`, '');

      process.stderr.write(`${finding.RuleID}: ${file}:${finding.StartLine}\n`);
    }

    throw new Error(`Secret scan failed (${findings.length} findings). Values suppressed.`);
  }

  process.stdout.write(`Security: ${mode} scan passed.\n`);
}

try {
  check();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
