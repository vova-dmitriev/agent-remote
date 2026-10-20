import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });

  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return sources(path);
      }

      return /\.tsx?$/.test(path) && !/\.(stories|test)\./.test(path) ? [path] : [];
    }),
  );

  return paths.flat();
}

it('uses shared constants for frontend machine error codes instead of inline strings', async () => {
  const violations: string[] = [];

  for (const path of await sources('apps/mini-app/src')) {
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) && /^[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(node.text)) {
        violations.push(
          `${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${node.text}`,
        );
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  expect(violations).toEqual([]);
});
