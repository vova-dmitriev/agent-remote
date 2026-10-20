import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const SERVER_SOURCE = 'apps/server/src';
const DATABASE_DIRECTORY = `${SERVER_SOURCE}/db/`;

const isSourceFile = (name) => name.endsWith('.ts') && !name.endsWith('.d.ts');

function listSourceFiles(directory) {
  let entries;

  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory() && entry.name !== 'node_modules') {
      return listSourceFiles(path);
    }

    return entry.isFile() && isSourceFile(entry.name) ? [path] : [];
  });
}

/** SQL may live in `repository.ts`, directly under a `repositories/` directory, or in the database layer. */
function mayQuery(path) {
  return (
    basename(path) === 'repository.ts' ||
    basename(dirname(path)) === 'repositories' ||
    path.startsWith(DATABASE_DIRECTORY)
  );
}

/** Every `<receiver>.query(...)` / `<receiver>.query<T>(...)` call: pg pools, transactions and clients alike. */
function queryLines(file) {
  const lines = [];

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'query'
    ) {
      const { line } = file.getLineAndCharacterOfPosition(node.expression.name.getStart(file));

      lines.push(line + 1);
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return lines;
}

export function checkSqlPlacement(root) {
  return listSourceFiles(join(root, SERVER_SOURCE))
    .map((file) => ({ file, path: relative(root, file).split(sep).join('/') }))
    .filter(({ path }) => !mayQuery(path))
    .sort((left, right) => left.path.localeCompare(right.path))
    .flatMap(({ file, path }) => {
      const parsed = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      return queryLines(parsed).map((line) => `${path}:${line}: SQL query outside a repository`);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  const issues = checkSqlPlacement(root);

  if (issues.length > 0) {
    console.error(issues.join('\n'));
    process.exit(1);
  }

  console.log('SQL stays in repositories');
}
