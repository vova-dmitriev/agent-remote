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
      .map((entry) => [entry.slice(entry.indexOf('\t') + 1), entry.split(' ')]),
  );

  const written = [];

  for (const file of files) {
    if (isPrivatePath(file)) {
      throw new Error(`Private/generated path must not be versioned: ${file}`);
    }

    const source = join(root, file);
    const [modeValue, object] = entries.get(file) ?? [];

    if (
      isUnsafeMode(modeValue) ||
      (!staged && lstatSync(source, { throwIfNoEntry: false })?.isSymbolicLink())
    ) {
      throw new Error(`Review symlink/submodule before publication: ${file}`);
    }

    if (!staged && !lstatSync(source, { throwIfNoEntry: false })?.isFile()) {
      continue;
    }

    written.push({ file, modeValue, object, source });
  }

  // The staged blobs in one `git cat-file` call: one `git show` per file took most of the hook's export.
  const blobs = staged
    ? indexBlobs(
        root,
        written.map((entry) => entry.object),
      )
    : [];

  written.forEach(({ file, modeValue, source }, index) => {
    const target = join(destination, file);

    mkdirSync(dirname(target), { recursive: true });

    writeFileSync(target, staged ? blobs[index] : readFileSync(source), {
      mode: modeValue === '100755' ? 0o700 : 0o600,
    });
  });

  return files.length;
}

/** The contents of the given blob ids, in order, from `git cat-file --batch` (`<id> blob <size>\n<bytes>\n` each). */
function indexBlobs(root, objects) {
  const output = git(['cat-file', '--batch'], root, {
    input: objects.join('\n') + '\n',
    maxBuffer: 1024 * 1024 * 1024,
  });

  const blobs = [];
  let offset = 0;

  for (const object of objects) {
    const header = output.indexOf(10, offset);
    const [id, type, size] = output.subarray(offset, header).toString().split(' ');

    if (id !== object || type !== 'blob') {
      throw new Error(`Staged object is not a blob: ${object}`);
    }

    const start = header + 1;

    blobs.push(output.subarray(start, start + Number(size)));
    offset = start + Number(size) + 1;
  }

  return blobs;
}
