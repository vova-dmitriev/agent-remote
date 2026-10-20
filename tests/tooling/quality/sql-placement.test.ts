import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error untyped build script
import { checkSqlPlacement, RAW_SQL_PENDING } from '../../../scripts/quality/check-sql-placement.mjs';

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

it('reports raw SQL anywhere outside the database layer, repositories included', () => {
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
    'apps/server/src/area/repository.ts': "export const a = (tx: any) => tx.query('SELECT 1');\n",
    'apps/server/src/area/repositories/rows.ts': [
      "import { sql } from 'drizzle-orm';",
      "export const b = (name: string) => sql.raw('SELECT ' + name);",
    ].join('\n'),
  });

  expect(checkSqlPlacement(root)).toEqual([
    'apps/server/src/area/repositories/rows.ts:2: sql.raw; use sql`` fragments with parameters',
    'apps/server/src/area/repository.ts:1: raw SQL query; use the Drizzle query builder',
    'apps/server/src/area/service.ts:2: raw SQL query; use the Drizzle query builder',
    'apps/server/src/area/service.ts:3: raw SQL query; use the Drizzle query builder',
    'apps/server/src/area/service.ts:5: raw SQL query; use the Drizzle query builder',
    'apps/server/src/area/service.ts:6: raw SQL query; use the Drizzle query builder',
  ]);
});

it('reports a value import of pg outside the database layer and allows type imports', () => {
  const root = project({
    'apps/server/src/area/repository.ts': [
      "import { Pool } from 'pg';",
      "import type { PoolClient } from 'pg';",
      "import { type QueryResult } from 'pg';",
      'export const pool = Pool;',
    ].join('\n'),
    'apps/server/src/db/database.ts':
      "import { Pool } from 'pg';\nexport const c = (client: any) => client.query('BEGIN');\n",
  });

  expect(checkSqlPlacement(root)).toEqual([
    'apps/server/src/area/repository.ts:1: pg import outside the database layer',
  ]);
});

it('accepts Drizzle builders and parameterised sql fragments in repositories', () => {
  const root = project({
    'apps/server/src/area/repository.ts': [
      "import { eq, sql } from 'drizzle-orm';",
      'export const read = (orm: any, table: any, id: string) =>',
      '  orm.select().from(table).where(eq(table.id, id)).having(sql`count(*) > ${1}`);',
    ].join('\n'),
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

it('lists only repositories that still hold raw SQL, so the list can only shrink', () => {
  for (const path of RAW_SQL_PENDING) {
    expect(existsSync(path), path).toBe(true);
    expect(readFileSync(path, 'utf8'), path).toMatch(/\.query[<(]/);
  }
});

it('passes on the repository', () => {
  expect(checkSqlPlacement(process.cwd())).toEqual([]);
});
