import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_FILES_PER_DIRECTORY = 6;

const sourceRoots = [
  'apps/daemon/src',
  'apps/server/src',
  'apps/desktop/src',
  'apps/chrome-extension/src',
  'packages/protocol/src',
  'packages/transport/src',
];

const isCounted = (name) => /\.(ts|mjs)$/.test(name) && name !== 'index.ts' && !name.endsWith('.d.ts');

export function checkSourceStructure(root) {
  const issues = [];

  const visit = (directory) => {
    let entries;

    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    const count = entries.filter((entry) => entry.isFile() && isCounted(entry.name)).length;

    if (count > MAX_FILES_PER_DIRECTORY) {
      issues.push(
        `${relative(root, directory)}: ${count} files, more than ${MAX_FILES_PER_DIRECTORY} files; group them into subdirectories by responsibility.`,
      );
    }

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        visit(join(directory, entry.name));
      }
    }
  };

  for (const sourceRoot of sourceRoots) {
    visit(join(root, sourceRoot));
  }

  return issues;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  const issues = checkSourceStructure(root);

  if (issues.length > 0) {
    console.error(issues.join('\n'));
    process.exit(1);
  }

  console.log('Source structure clean');
}
