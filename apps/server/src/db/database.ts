import { Pool, type PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';

export class Database {
  readonly pool: Pool;
  constructor(url: string, schema = 'public') {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
      throw new Error('INVALID_DB_SCHEMA');
    }

    this.pool = new Pool({
      connectionString: url,
      max: 10,
      options: `-c search_path=${schema}`,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
  }
  async migrate() {
    const sql = await readFile(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8');

    await this.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(67211301)');
      await tx.query(sql);
    });
  }
  async transaction<T>(operation: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.pool.connect();

    try {
      await tx.query('BEGIN');
      const result = await operation(tx);

      await tx.query('COMMIT');

      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  }
  close() {
    return this.pool.end();
  }
}
