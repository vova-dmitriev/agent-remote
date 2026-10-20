import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
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

/**
 * Raw SQL lives only in the database layer (migrations, the journal, transactions). Repositories use Drizzle's query
 * builder; `sql` fragments are allowed there for constructs the builder lacks, never `sql.raw`.
 */
function mayQuery(path) {
  return path.startsWith(DATABASE_DIRECTORY);
}

/**
 * Repositories still on raw SQL while the move to Drizzle is in progress (Tasks 38–39). The list only shrinks:
 * a file leaves it when it is migrated, and Task 40 empties it.
 */
export const RAW_SQL_PENDING = new Set([
  'apps/server/src/commands/repositories/audit.ts',
  'apps/server/src/commands/repositories/claims.ts',
  'apps/server/src/continuity/repositories/conversations.ts',
  'apps/server/src/continuity/repositories/handoffs.ts',
  'apps/server/src/history/repository.ts',
  'apps/server/src/notifications/repositories/notifications.ts',
  'apps/server/src/profiles/routing/repository.ts',
  'apps/server/src/reading-position/repository.ts',
  'apps/server/src/sessions/repository.ts',
]);

/** Raw SQL entry points: every `<receiver>.query(...)` call, every `sql.raw(...)` and every value import of `pg`. */
function rawSql(file) {
  const found = [];
  const at = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const receiver = node.expression.expression;

      if (name === 'query') {
        found.push({ line: at(node.expression.name), kind: 'raw SQL query; use the Drizzle query builder' });
      } else if (name === 'raw' && ts.isIdentifier(receiver) && receiver.text === 'sql') {
        found.push({ line: at(node.expression.name), kind: 'sql.raw; use sql`` fragments with parameters' });
      }
    }

    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'pg' &&
      !node.importClause?.isTypeOnly &&
      !node.importClause?.namedBindings?.elements?.every((element) => element.isTypeOnly)
    ) {
      found.push({ line: at(node), kind: 'pg import outside the database layer' });
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return found;
}

export function checkSqlPlacement(root) {
  return listSourceFiles(join(root, SERVER_SOURCE))
    .map((file) => ({ file, path: relative(root, file).split(sep).join('/') }))
    .filter(({ path }) => !mayQuery(path) && !RAW_SQL_PENDING.has(path))
    .sort((left, right) => left.path.localeCompare(right.path))
    .flatMap(({ file, path }) => {
      const parsed = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      return rawSql(parsed).map(({ line, kind }) => `${path}:${line}: ${kind}`);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  const issues = checkSqlPlacement(root);

  if (issues.length > 0) {
    console.error(issues.join('\n'));
    process.exit(1);
  }

  console.log('No raw SQL outside the database layer');
}
