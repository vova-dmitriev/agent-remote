import { ServerErrorCode } from '../error-codes.js';
import { Pool, type PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';
import { readFile } from 'node:fs/promises';
import { applyMigrationJournal, MigrationVersion } from './migration-journal.js';

/** Typed query builder over the relay schema; repositories use it instead of SQL strings. */
export type Orm = NodePgDatabase<typeof schema>;

/** Binds the query builder to a pool or to one transaction's client, so a transaction stays on its connection. */
export const ormOn = (client: Pool | PoolClient): Orm => drizzle({ client, schema });

export class Database {
  readonly pool: Pool;
  readonly orm: Orm;
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

    this.orm = ormOn(this.pool);
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
        [MigrationVersion.CommandAuditCreatedAt, '008_command_audit_created_at.sql'],
        [MigrationVersion.NotificationPayload, '009_notification_payload.sql'],
        [MigrationVersion.TelegramActions, '010_telegram_actions.sql'],
        [MigrationVersion.SessionCatalog, '011_session_catalog.sql'],
        [MigrationVersion.ClientLinks, '012_client_links.sql'],
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
