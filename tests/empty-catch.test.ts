import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const SOURCE_ROOTS = ['apps/daemon/src', 'apps/server/src'];
const IGNORE_MARK = /\/\/ ignore: \S/;

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
  });

/** A `.catch(...)` handler that does nothing: `() => {}`, `() => undefined`. */
function emptyHandler(node: ts.Node): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
    return false;
  }

  const { body } = node;

  return ts.isBlock(body) ? body.statements.length === 0 : ts.isIdentifier(body) && body.text === 'undefined';
}

/** Every swallowed error, as `file:line`, whose line does not say why it is ignored. */
function unexplainedCatches(root: string): string[] {
  return SOURCE_ROOTS.flatMap((sourceRoot) => sourceFiles(join(root, sourceRoot))).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const lines = text.split('\n');
    const found: string[] = [];

    const check = (end: number) => {
      const line = source.getLineAndCharacterOfPosition(end).line;

      if (!IGNORE_MARK.test(lines[line] ?? '')) {
        found.push(`${relative(root, file)}:${line + 1}`);
      }
    };

    const visit = (node: ts.Node) => {
      if (ts.isCatchClause(node) && node.block.statements.length === 0) {
        check(node.block.end);
      }

      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'catch' &&
        node.arguments.length === 1 &&
        emptyHandler(node.arguments[0]!)
      ) {
        check(node.end);
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    return found;
  });
}

it('logs every swallowed error in the companion and the relay, or says on the same line why it is ignored', () => {
  expect(unexplainedCatches(process.cwd())).toEqual([]);
});
