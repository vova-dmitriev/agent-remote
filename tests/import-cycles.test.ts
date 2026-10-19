import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error untyped build script
import { cycleRoots, findCycles, gatedCycleLevels } from '../scripts/check-cycles.mjs';

const roots: string[] = [];

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'import-cycles-'));

  roots.push(root);

  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), source);
  }

  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

it('reports a file-level cycle a -> b -> a', () => {
  const root = project({
    'a.ts': "import { b } from './b.js';\nexport const a = b;\n",
    'b.ts': "import type { A } from './a.js';\nexport const b = 1;\nexport type B = A;\n",
  });

  expect(findCycles(root, 'file')).toEqual([['a.ts', 'b.ts']]);
});

it('reports a module-level cycle x/1 -> y/1, y/2 -> x/2', () => {
  const root = project({
    'x/1.ts': "export { one } from '../y/1.js';\n",
    'x/2.ts': 'export const two = 2;\n',
    'y/1.ts': 'export const one = 1;\n',
    'y/2.ts': "import {\n  two,\n} from '../x/2.js';\nexport const value = two;\n",
  });

  expect(findCycles(root, 'file')).toEqual([]);
  expect(findCycles(root, 'module')).toEqual([['x', 'y']]);
});

it('ignores alias imports, dynamic imports and strings that look like imports', () => {
  const root = project({
    'a.ts':
      "import { x } from '@protocol';\nexport const load = () => import('./b.js');\nexport const a = x;\n",
    'b.ts': "import './c.js';\nexport const text = \"import { a } from './a.js'\";\n",
    'c.ts': 'export {};\n',
  });

  expect(findCycles(root, 'file')).toEqual([]);
});

it.each(cycleRoots(process.cwd()) as string[])('finds no gated import cycles in %s', (sourceRoot) => {
  const root = join(process.cwd(), sourceRoot);

  for (const level of gatedCycleLevels(sourceRoot) as string[]) {
    expect(findCycles(root, level)).toEqual([]);
  }
});

it('gates every source root at file level', () => {
  for (const sourceRoot of cycleRoots(process.cwd()) as string[]) {
    expect(gatedCycleLevels(sourceRoot)).toContain('file');
  }
});

it('gates the daemon at module level', () => {
  expect(gatedCycleLevels('apps/daemon/src')).toEqual(['file', 'module']);
});
