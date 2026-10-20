import { afterAll, beforeAll, expect, it } from 'vitest';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../../apps/server/src/db/schema/index.js';
import { databaseFixture } from '../../helpers/database.js';

const JOURNAL = 'server_schema_migrations';
const tables = Object.values(schema).filter((value) => is(value, PgTable)) as unknown as PgTable[];

let fixture: Awaited<ReturnType<typeof databaseFixture>>;

beforeAll(async () => {
  fixture = await databaseFixture();
});

afterAll(async () => {
  await fixture?.close();
});

/** information_schema type of a column, in the spelling drizzle's `getSQLType()` uses. */
function sqlType(row: { data_type: string; character_maximum_length: number | null }) {
  if (row.data_type === 'character') {
    return `char(${row.character_maximum_length})`;
  }

  return row.data_type;
}

it('declares every migrated table, column, type and nullability in the drizzle schema', async () => {
  const { rows } = await fixture.db.pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    character_maximum_length: number | null;
    is_nullable: 'YES' | 'NO';
  }>(
    `SELECT table_name,column_name,data_type,character_maximum_length,is_nullable FROM information_schema.columns
     WHERE table_schema=$1 AND table_name<>$2 ORDER BY table_name,column_name`,
    [fixture.schema, JOURNAL],
  );

  const database = rows.map(
    (row) =>
      `${row.table_name}.${row.column_name} ${sqlType(row)} ${row.is_nullable === 'NO' ? 'not null' : 'null'}`,
  );

  const declared = tables
    .flatMap((table) => {
      const config = getTableConfig(table);

      return config.columns.map(
        (column) =>
          `${config.name}.${column.name} ${column.getSQLType()} ${column.notNull ? 'not null' : 'null'}`,
      );
    })
    .sort();

  expect(declared).toEqual(database);
});

it('declares every index the queries rely on, and no index the database lacks', async () => {
  const { rows } = await fixture.db.pool.query<{ indexname: string }>(
    `SELECT i.indexname FROM pg_indexes i
     WHERE i.schemaname=$1 AND i.tablename<>$2
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname=i.indexname)
     ORDER BY i.indexname`,
    [fixture.schema, JOURNAL],
  );

  const declared = tables
    .flatMap((table) => getTableConfig(table).indexes.map((index) => index.config.name!))
    .sort();

  expect(declared).toEqual(rows.map((row) => row.indexname));
});
