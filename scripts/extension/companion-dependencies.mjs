import { cp, lstat, mkdir, readFile, readdir, realpath, symlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

async function runtimeDependencies(directory, names = new Set()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      await runtimeDependencies(path, names);
      continue;
    }

    if (!/\.m?js$/.test(entry.name)) {
      continue;
    }

    const code = await readFile(path, 'utf8');
    const pattern = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)(['"])([^'"]+)\1/g;

    for (const match of code.matchAll(pattern)) {
      const name = match[2];

      if (name.startsWith('.') || name.startsWith('/') || isBuiltin(name)) {
        continue;
      }

      names.add(name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]);
    }
  }

  return names;
}

const excluded = new Set([
  'node_modules',
  '.git',
  '.github',
  'test',
  'tests',
  '__tests__',
  'docs',
  'examples',
  'coverage',
  '.cache',
]);

const inside = (root, path) => {
  const rest = relative(root, path);

  return !rest || (!rest.startsWith(`..${sep}`) && rest !== '..' && !isAbsolute(rest));
};

export async function copyTree(source, target, trustedRoot = source) {
  await cp(source, target, {
    recursive: true,
    dereference: true,
    filter: async (path) => {
      const parts = relative(source, path).split(sep);

      if (parts.some((part) => excluded.has(part))) {
        return false;
      }

      if (!inside(trustedRoot, await realpath(path))) {
        throw new Error('Dependency symlink escapes trusted resources');
      }

      if (
        parts.includes('build') &&
        !path.endsWith('.node') &&
        !path.endsWith('spawn-helper') &&
        !(await lstat(path)).isDirectory()
      ) {
        return false;
      }

      return true;
    },
  });
}

function resolveDependency(name, parent) {
  const require = createRequire(join(parent, 'package.json'));

  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    let directory = dirname(require.resolve(name));

    while (dirname(directory) !== directory) {
      try {
        if (JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name === name) {
          return directory;
        }
      } catch {
        /* Search the entrypoint's enclosing package. */
      }

      directory = dirname(directory);
    }

    throw new Error('Required production dependency not found');
  }
}

export async function copyDependencies(source, output) {
  const copied = new Map();
  const cache = await realpath(join(source, 'node_modules'));

  const walk = async (parent, target, selected) => {
    const manifest = JSON.parse(await readFile(join(parent, 'package.json'), 'utf8'));
    const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };

    for (const name of selected ?? Object.keys(dependencies)) {
      let packageRoot;

      try {
        packageRoot = await realpath(resolveDependency(name, parent));
      } catch (error) {
        if (Object.hasOwn(manifest.optionalDependencies ?? {}, name)) {
          continue;
        }

        throw error;
      }

      if (!inside(cache, packageRoot)) {
        throw new Error('Dependency resolves outside installed production resources');
      }

      const destination = join(target, 'node_modules', name);

      await mkdir(dirname(destination), { recursive: true });
      const previous = copied.get(packageRoot);

      if (previous) {
        await symlink(relative(dirname(destination), previous), destination, 'dir');
        continue;
      }

      copied.set(packageRoot, destination);
      await copyTree(packageRoot, destination, cache);
      await walk(packageRoot, destination);
    }
  };

  await walk(source, output, await runtimeDependencies(join(output, 'dist')));
}

export async function copyCompanionHelper(source, output) {
  const bundle = 'artifacts/ClaudeRemoteBridge.app';
  const path = `${bundle}/Contents/MacOS/ClaudeBridge`;
  let app;

  try {
    app = await lstat(join(source, bundle));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }

  const executable = await lstat(join(source, path));

  if (
    !app.isDirectory() ||
    app.isSymbolicLink() ||
    app.mode & 0o022 ||
    (app.uid !== process.getuid?.() && app.uid !== 0) ||
    !executable.isFile() ||
    executable.isSymbolicLink() ||
    executable.mode & 0o022 ||
    !(executable.mode & 0o100) ||
    (executable.uid !== process.getuid?.() && executable.uid !== 0)
  ) {
    throw new Error('Unsafe companion helper bundle');
  }

  await copyTree(join(source, bundle), join(output, bundle));

  const sha256 = createHash('sha256')
    .update(await readFile(join(output, path)))
    .digest('hex');

  return { path, sha256 };
}
