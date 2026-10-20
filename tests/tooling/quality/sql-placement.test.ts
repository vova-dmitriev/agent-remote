import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error untyped build script
import { checkSqlPlacement } from '../../../scripts/check-sql-placement.mjs';

const roots: string[] = [];

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'sql-placement-'));

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

it('reports a stray pool, transaction or client query outside a repository', () => {
  const root = project({
    'apps/server/src/area/service.ts': [
      'export async function run(db: any, tx: any, client: any) {',
      "  await db.pool.query('SELECT 1');",
      "  await tx.query<{ id: string }>('SELECT 2');",
      '  await this.db.pool',
      "    .query('SELECT 3');",
      "  await client.query('SELECT 4');",
      '}',
    ].join('\n'),
  });

  expect(checkSqlPlacement(root)).toEqual([
    'apps/server/src/area/service.ts:2: SQL query outside a repository',
    'apps/server/src/area/service.ts:3: SQL query outside a repository',
    'apps/server/src/area/service.ts:5: SQL query outside a repository',
    'apps/server/src/area/service.ts:6: SQL query outside a repository',
  ]);
});

it('accepts queries in repository.ts, repositories/*.ts and db/*', () => {
  const root = project({
    'apps/server/src/area/repository.ts': "export const a = (tx: any) => tx.query('SELECT 1');\n",
    'apps/server/src/area/repositories/rows.ts': "export const b = (db: any) => db.pool.query('SELECT 1');\n",
    'apps/server/src/db/database.ts': "export const c = (client: any) => client.query('BEGIN');\n",
  });

  expect(checkSqlPlacement(root)).toEqual([]);
});

it('ignores code that only names a query', () => {
  const root = project({
    'apps/server/src/area/controller.ts': [
      'export function read(@Query() query: Record<string, unknown>) {',
      '  return query.before;',
      '}',
    ].join('\n'),
  });

  expect(checkSqlPlacement(root)).toEqual([]);
});

it('passes on the repository', () => {
  expect(checkSqlPlacement(process.cwd())).toEqual([]);
});
