import { execFileSync } from 'node:child_process';
import { mkdirSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isPrivatePath, isUnsafeMode, ScanMode } from './policy.mjs';

export function git(args, cwd, options = {}) {
  return execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, ...options });
}

export function exportSnapshot(root, destination, mode) {
  const staged = mode === ScanMode.Staged;
  const args = ['ls-files', '-z', '--cached'];

  if (!staged) {
    args.push('--others', '--exclude-standard');
  }

  const files = [...new Set(git(args, root).toString().split('\0').filter(Boolean))];

  const entries = new Map(
    git(['ls-files', '--stage', '-z'], root)
      .toString()
      .split('\0')
      .filter(Boolean)
      .map((entry) => [entry.slice(entry.indexOf('\t') + 1), entry.split(' ')[0]]),
  );

  for (const file of files) {
    if (isPrivatePath(file)) {
      throw new Error(`Private/generated path must not be versioned: ${file}`);
    }

    const source = join(root, file);
    const modeValue = entries.get(file);

    if (
      isUnsafeMode(modeValue) ||
      (!staged && lstatSync(source, { throwIfNoEntry: false })?.isSymbolicLink())
    ) {
      throw new Error(`Review symlink/submodule before publication: ${file}`);
    }

    if (!staged && !lstatSync(source, { throwIfNoEntry: false })?.isFile()) {
      continue;
    }

    const content = staged ? git(['show', `:${file}`], root) : readFileSync(source);
    const target = join(destination, file);

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { mode: modeValue === '100755' ? 0o700 : 0o600 });
  }

  return files.length;
}
