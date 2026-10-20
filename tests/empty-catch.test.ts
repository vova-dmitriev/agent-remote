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

/** Names of same-file functions that do nothing, such as `const noop = () => {}`. */
function emptyFunctionNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isNoOp(node.initializer)
    ) {
      names.add(node.name.text);
    }

    if (ts.isFunctionDeclaration(node) && node.name && node.body && node.body.statements.length === 0) {
      names.add(node.name.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return names;
}

/** A handler that does nothing: `() => {}`, `() => undefined`, `() => null`, `() => void 0`. */
function isNoOp(node: ts.Node): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
    return false;
  }

  const { body } = node;

  if (ts.isBlock(body)) {
    return body.statements.length === 0;
  }

  return (
    (ts.isIdentifier(body) && body.text === 'undefined') ||
    body.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isVoidExpression(body) && ts.isLiteralExpression(body.expression))
  );
}

/** The error handler a call passes, if it is one: `.catch(h)`, `.then(x, h)`, `.on('error', h)`, `.once('error', h)`. */
function errorHandler(node: ts.CallExpression): ts.Expression | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }

  const method = node.expression.name.text;
  const [first, second] = node.arguments;

  if (method === 'catch' && node.arguments.length === 1) {
    return first;
  }

  if (method === 'then' && node.arguments.length === 2) {
    return second;
  }

  if (
    (method === 'on' || method === 'once') &&
    first &&
    ts.isStringLiteralLike(first) &&
    first.text === 'error'
  ) {
    return second;
  }

  return undefined;
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

    const noOps = emptyFunctionNames(source);

    const visit = (node: ts.Node) => {
      if (ts.isCatchClause(node) && node.block.statements.length === 0) {
        check(node.block.end);
      }

      const handler = ts.isCallExpression(node) ? errorHandler(node) : undefined;

      if (
        handler &&
        (isNoOp(handler) ||
          (ts.isIdentifier(handler) && (noOps.has(handler.text) || /^noop$/i.test(handler.text))))
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
