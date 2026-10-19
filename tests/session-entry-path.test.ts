import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';

const spawners = [
  'apps/daemon/src/setup-cli.ts',
  'apps/daemon/src/runtime/services/create-session.ts',
  'apps/daemon/src/sessions/restart-session.ts',
];

it.each(spawners)('%s spawns the session entry that exists', (spawner) => {
  const source = readFileSync(spawner, 'utf8');
  const specifier = /new URL\('([^']*entry\.js)', import\.meta\.url\)/.exec(source)?.[1];

  expect(specifier).toBeDefined();

  expect(resolve(dirname(spawner), specifier!.replace(/\.js$/, '.ts'))).toBe(
    resolve('apps/daemon/src/entry/entry.ts'),
  );

  expect(existsSync('apps/daemon/src/entry/entry.ts')).toBe(true);
});
