import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error untyped build script
import { checkSourceStructure, sourceRoots } from '../../../scripts/quality/check-source-structure.mjs';

const roots: string[] = [];

// A temporary repository with every configured root present.
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'source-structure-'));

  roots.push(root);

  for (const { path } of sourceRoots as { path: string }[]) {
    mkdirSync(join(root, path), { recursive: true });
  }

  return root;
}

function project(names: string[]): string {
  const root = repository();
  const directory = join(root, 'apps/daemon/src/area');

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

function filesProject(directory: string, count: number, extension = '.test.ts'): string {
  const root = repository();

  mkdirSync(join(root, directory), { recursive: true });

  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(root, directory, `case-${index}${extension}`), '');
  }

  return root;
}

const testsProject = (directory: string, count: number) => filesProject(join('tests', directory), count);

it('allows 12 test files in a tests directory and flags 13', () => {
  expect(checkSourceStructure(testsProject('server/area', 12))).toEqual([]);

  expect(checkSourceStructure(testsProject('server/area', 13))).toEqual([
    expect.stringContaining('more than 12 files'),
  ]);
});

it('applies the test cap to the browser suites and shared helpers', () => {
  for (const directory of ['e2e/x', 'e2e/support', 'extension-e2e', 'desktop-e2e', 'helpers']) {
    expect(checkSourceStructure(testsProject(directory, 12))).toEqual([]);

    expect(checkSourceStructure(testsProject(directory, 13))).toEqual([
      expect.stringContaining('more than 12 files'),
    ]);
  }
});

it('caps scripts at 6 files per directory', () => {
  expect(checkSourceStructure(filesProject('scripts/area', 6, '.mjs'))).toEqual([]);

  expect(checkSourceStructure(filesProject('scripts/area', 7, '.mjs'))).toEqual([
    expect.stringContaining('more than 6 files'),
  ]);
});

it('fails on a misspelled or missing configured root instead of skipping it', () => {
  const root = repository();

  expect(checkSourceStructure(root, [{ path: 'apps/deamon/src', max: 6 }])).toEqual([
    expect.stringContaining('apps/deamon/src: cannot be read (ENOENT)'),
  ]);

  rmSync(join(root, 'scripts'), { recursive: true });

  expect(checkSourceStructure(root)).toEqual([expect.stringContaining('scripts: cannot be read (ENOENT)')]);
});

it('ignores index.ts and .d.ts', () => {
  const root = project(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'index.ts', 'x.d.ts']);

  expect(checkSourceStructure(root)).toEqual([]);
});

it('passes on the repository', () => {
  expect(checkSourceStructure(process.cwd())).toEqual([]);
});
