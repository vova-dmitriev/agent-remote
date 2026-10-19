import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error untyped build script
import { checkSourceStructure } from '../scripts/check-source-structure.mjs';

const roots: string[] = [];

function project(names: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'source-structure-'));
  const directory = join(root, 'apps/daemon/src/area');

  roots.push(root);
  mkdirSync(directory, { recursive: true });

  for (const name of names) {
    writeFileSync(join(directory, name), '');
  }

  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

it('flags a directory with 7 source files', () => {
  const root = project(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts']);

  expect(checkSourceStructure(root)).toEqual([expect.stringContaining('more than 6 files')]);
});

it('ignores index.ts and .d.ts', () => {
  const root = project(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'index.ts', 'x.d.ts']);

  expect(checkSourceStructure(root)).toEqual([]);
});

it('passes on the repository', () => {
  expect(checkSourceStructure(process.cwd())).toEqual([]);
});
