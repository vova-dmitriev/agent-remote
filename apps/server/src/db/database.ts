import { ServerErrorCode } from '../error-codes.js';
import { Pool, type PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { applyMigrationJournal, MigrationVersion } from './migration-journal.js';

export class Database {
  readonly pool: Pool;
  constructor(url: string, schema = 'public') {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
      throw new Error(ServerErrorCode.INVALID_DB_SCHEMA);
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
    const migrations = await Promise.all(
      [
        [MigrationVersion.Initial, '001_initial.sql'],
        [MigrationVersion.ExecutionProfiles, '002_execution_profiles.sql'],
        [MigrationVersion.Continuity, '003_continuity.sql'],
        [MigrationVersion.ContinuityCommandProofs, '004_continuity_command_proofs.sql'],
        [MigrationVersion.HandoffCreateEvidence, '005_handoff_create_evidence.sql'],
        [MigrationVersion.AttachmentCache, '006_attachment_cache.sql'],
        [MigrationVersion.ProfileRouting, '007_profile_routing.sql'],
      ].map(async ([version, file]) => ({
        version: version as MigrationVersion,
        sql: await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8'),
      })),
    );

    await this.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(67211301)');
      await applyMigrationJournal(tx, migrations);
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
