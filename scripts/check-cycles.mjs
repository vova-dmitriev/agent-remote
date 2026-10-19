import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const CYCLE_LEVEL = Object.freeze({ file: 'file', module: 'module' });

const appSourceRoots = ['apps/daemon/src', 'apps/server/src'];

/** Source roots whose module-level graph must also be acyclic; every root is gated at file level. */
const moduleGatedRoots = new Set([]);

export function cycleRoots(repositoryRoot) {
  const packages = join(repositoryRoot, 'packages');

  const packageRoots = readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(packages, entry.name, 'src')))
    .map((entry) => `packages/${entry.name}/src`)
    .sort();

  return [...appSourceRoots, ...packageRoots];
}

export function gatedCycleLevels(sourceRoot) {
  return moduleGatedRoots.has(sourceRoot) ? [CYCLE_LEVEL.file, CYCLE_LEVEL.module] : [CYCLE_LEVEL.file];
}

const isSourceFile = (name) => name.endsWith('.ts') && !name.endsWith('.d.ts');

function listSourceFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory() && entry.name !== 'node_modules') {
      files.push(...listSourceFiles(path));
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

function staticSpecifiers(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, false);
  const specifiers = [];

  for (const statement of source.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }

  return specifiers;
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return undefined;
  }

  const target = resolve(dirname(fromFile), specifier);

  const candidates = [
    target.replace(/\.(js|mjs)$/, (extension) => (extension === '.js' ? '.ts' : '.mts')),
    target,
    `${target}.ts`,
    join(target, 'index.ts'),
  ];

  return candidates.find((candidate) => isSourceFile(candidate) && isFile(candidate));
}

function nodeName(root, file, level) {
  const path = relative(root, file).split(sep).join('/');

  return level === CYCLE_LEVEL.module ? path.split('/')[0] : path;
}

function stronglyConnected(graph) {
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let nextIndex = 0;

  const visit = (node) => {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of graph.get(node) ?? []) {
      if (!indexes.has(next)) {
        visit(next);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(next)));
      } else if (onStack.has(next)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indexes.get(next)));
      }
    }

    if (lowLinks.get(node) === indexes.get(node)) {
      const component = [];
      let member;

      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);

      components.push(component);
    }
  };

  for (const node of graph.keys()) {
    if (!indexes.has(node)) {
      visit(node);
    }
  }

  return components;
}

export function findCycles(root, level) {
  if (!Object.values(CYCLE_LEVEL).includes(level)) {
    throw new Error(`Unknown cycle level: ${level}`);
  }

  const graph = new Map();

  for (const file of listSourceFiles(root)) {
    const from = nodeName(root, file, level);
    const edges = graph.get(from) ?? new Set();

    graph.set(from, edges);

    for (const specifier of staticSpecifiers(file)) {
      const target = resolveRelative(file, specifier);

      if (target && !relative(root, target).startsWith('..')) {
        const to = nodeName(root, target, level);

        if (to !== from || level === CYCLE_LEVEL.file) {
          edges.add(to);
        }
      }
    }
  }

  return stronglyConnected(graph)
    .filter((component) => component.length > 1 || graph.get(component[0]).has(component[0]))
    .map((component) => component.sort())
    .sort((left, right) => left[0].localeCompare(right[0]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const repositoryRoot = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  const issues = [];

  for (const sourceRoot of cycleRoots(repositoryRoot)) {
    for (const level of gatedCycleLevels(sourceRoot)) {
      for (const cycle of findCycles(join(repositoryRoot, sourceRoot), level)) {
        issues.push(`${sourceRoot} ${level} cycle: ${cycle.join(' <-> ')}`);
      }
    }
  }

  if (issues.length > 0) {
    console.error(issues.join('\n'));
    process.exit(1);
  }

  console.log('No gated import cycles');
}
