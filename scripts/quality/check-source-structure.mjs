import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_FILES_PER_DIRECTORY = 6;
const MAX_TEST_FILES_PER_DIRECTORY = 12;

// Every configured root must exist: a misspelled or removed root fails the gate instead of passing silently.
export const sourceRoots = [
  { path: 'apps/daemon/src', max: MAX_FILES_PER_DIRECTORY },
  { path: 'apps/server/src', max: MAX_FILES_PER_DIRECTORY },
  { path: 'apps/desktop/src', max: MAX_FILES_PER_DIRECTORY },
  { path: 'apps/chrome-extension/src', max: MAX_FILES_PER_DIRECTORY },
  { path: 'packages/protocol/src', max: MAX_FILES_PER_DIRECTORY },
  { path: 'packages/transport/src', max: MAX_FILES_PER_DIRECTORY },
  // Tooling scripts are code like src and follow the same cap.
  { path: 'scripts', max: MAX_FILES_PER_DIRECTORY },
  // The whole test tree, browser suites and shared helpers included.
  { path: 'tests', max: MAX_TEST_FILES_PER_DIRECTORY },
];

const isCounted = (name) => /\.(ts|mjs)$/.test(name) && name !== 'index.ts' && !name.endsWith('.d.ts');

export function checkSourceStructure(root, roots = sourceRoots) {
  const issues = [];

  const visit = (directory, max) => {
    let entries;

    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      issues.push(`${relative(root, directory)}: cannot be read (${error.code ?? error.message}).`);

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
        visit(join(directory, entry.name), max);
      }
    }
  };

  for (const { path, max } of roots) {
    visit(join(root, path), max);
  }

  return issues;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../..', import.meta.url)));
  const issues = checkSourceStructure(root);

  if (issues.length > 0) {
    console.error(issues.join('\n'));
    process.exit(1);
  }

  console.log('Source structure clean');
}
