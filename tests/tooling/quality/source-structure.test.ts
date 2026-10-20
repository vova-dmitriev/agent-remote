import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error untyped build script
import { checkSourceStructure } from '../../../scripts/check-source-structure.mjs';

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

function testsProject(directory: string, count: number): string {
  const root = mkdtempSync(join(tmpdir(), 'source-structure-'));

  roots.push(root);
  mkdirSync(join(root, 'tests', directory), { recursive: true });

  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(root, 'tests', directory, `case-${index}.test.ts`), '');
  }

  return root;
}

it('allows 12 test files in a tests directory and flags 13', () => {
  expect(checkSourceStructure(testsProject('server/area', 12))).toEqual([]);

  expect(checkSourceStructure(testsProject('server/area', 13))).toEqual([
    expect.stringContaining('more than 12 files'),
  ]);
});

it('leaves the browser suites and shared helpers outside the test cap', () => {
  for (const directory of ['e2e', 'extension-e2e', 'desktop-e2e', 'helpers']) {
    expect(checkSourceStructure(testsProject(directory, 13))).toEqual([]);
  }
});

it('ignores index.ts and .d.ts', () => {
  const root = project(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'index.ts', 'x.d.ts']);

  expect(checkSourceStructure(root)).toEqual([]);
});

it('passes on the repository', () => {
  expect(checkSourceStructure(process.cwd())).toEqual([]);
});
