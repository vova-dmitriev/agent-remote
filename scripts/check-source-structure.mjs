import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_FILES_PER_DIRECTORY = 6;
const MAX_TEST_FILES_PER_DIRECTORY = 12;

const sourceRoots = [
  { path: 'apps/daemon/src', max: MAX_FILES_PER_DIRECTORY },
  { path: 'apps/server/src', max: MAX_FILES_PER_DIRECTORY },
  { path: 'apps/desktop/src', max: MAX_FILES_PER_DIRECTORY },
  { path: 'apps/chrome-extension/src', max: MAX_FILES_PER_DIRECTORY },
  { path: 'packages/protocol/src', max: MAX_FILES_PER_DIRECTORY },
  { path: 'packages/transport/src', max: MAX_FILES_PER_DIRECTORY },
  // The mirrored test tree. The browser suites and the shared helper pool keep their own layout.
  {
    path: 'tests',
    max: MAX_TEST_FILES_PER_DIRECTORY,
    skip: ['tests/e2e', 'tests/extension-e2e', 'tests/desktop-e2e', 'tests/helpers'],
  },
];

const isCounted = (name) => /\.(ts|mjs)$/.test(name) && name !== 'index.ts' && !name.endsWith('.d.ts');

export function checkSourceStructure(root) {
  const issues = [];

  const visit = (directory, limits) => {
    const { max, skip = [] } = limits;

    if (skip.includes(relative(root, directory))) {
      return;
    }

    let entries;

    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    const count = entries.filter((entry) => entry.isFile() && isCounted(entry.name)).length;

    if (count > max) {
      issues.push(
        `${relative(root, directory)}: ${count} files, more than ${max} files; group them into subdirectories by responsibility.`,
      );
    }

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        visit(join(directory, entry.name), limits);
      }
    }
  };

  for (const { path, ...limits } of sourceRoots) {
    visit(join(root, path), limits);
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
