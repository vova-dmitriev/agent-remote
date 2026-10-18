import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = [
  'apps/chrome-extension/src',
  'apps/daemon/src/browser',
  'apps/daemon/src/local',
  'packages/transport/src/native',
];

function reject(category) {
  throw new Error(`Extension source rejected: ${category}`);
}

export function checkExtensionSource(repository) {
  const visit = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true });

    const files = entries.filter(
      (entry) => entry.isFile() && entry.name !== 'index.ts' && !entry.name.startsWith('.'),
    );

    if (files.length > 6) {
      reject('more than six implementation files in a directory');
    }

    for (const entry of entries) {
      const path = join(directory, entry.name);

      if (entry.isSymbolicLink()) {
        reject('symlink in source');
      }

      if (entry.isDirectory()) {
        visit(path);
      } else if (['.ts', '.tsx', '.js', '.mjs'].includes(extname(path))) {
        const content = readFileSync(path, 'utf8');
        const lines = content.split('\n').length - Number(content.endsWith('\n'));

        if (lines > 200) {
          reject('source file exceeds 200 lines');
        }
      }
    }
  };

  try {
    for (const root of roots) {
      const directory = resolve(repository, root);

      if (lstatSync(directory).isSymbolicLink()) {
        reject('symlink source root');
      }

      visit(directory);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Extension source rejected:')) {
      throw error;
    }

    reject('unavailable source root');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);

    if (args.length && (args.length !== 2 || args[0] !== '--root')) {
      reject('invalid check arguments');
    }

    checkExtensionSource(args[1] ?? fileURLToPath(new URL('../../', import.meta.url)));
    console.log('Extension source structure verified');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
