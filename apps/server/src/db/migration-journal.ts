import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

export const MigrationVersion = {
  Initial: '001_initial',
  ExecutionProfiles: '002_execution_profiles',
  Continuity: '003_continuity',
  ContinuityCommandProofs: '004_continuity_command_proofs',
  HandoffCreateEvidence: '005_handoff_create_evidence',
  AttachmentCache: '006_attachment_cache',
  ProfileRouting: '007_profile_routing',
  CommandAuditCreatedAt: '008_command_audit_created_at',
  NotificationPayload: '009_notification_payload',
} as const;
export type MigrationVersion = (typeof MigrationVersion)[keyof typeof MigrationVersion];
export const MigrationError = {
  ChecksumMismatch: 'MIGRATION_CHECKSUM_MISMATCH',
  LegacySchemaIncomplete: 'MIGRATION_LEGACY_SCHEMA_INCOMPLETE',
} as const;
export interface MigrationInput {
  version: MigrationVersion;
  sql: string;
}

const legacyTables: Record<MigrationVersion, readonly string[]> = {
  [MigrationVersion.Initial]: ['users', 'devices', 'sessions', 'events'],
  [MigrationVersion.ExecutionProfiles]: ['execution_profile_metadata'],
  [MigrationVersion.Continuity]: [
    'continuity_conversations',
    'execution_links',
    'handoff_operations',
    'handoff_command_ids',
  ],
  [MigrationVersion.ContinuityCommandProofs]: ['command_id_claims', 'handoff_seed_proofs'],
  [MigrationVersion.HandoffCreateEvidence]: [],
  [MigrationVersion.AttachmentCache]: [],
  [MigrationVersion.ProfileRouting]: ['profile_routing_settings', 'profile_quota_observations'],
  [MigrationVersion.CommandAuditCreatedAt]: [],
  [MigrationVersion.NotificationPayload]: [],
};

const digest = (sql: string) => createHash('sha256').update(sql).digest('hex');

const replayOnLegacyAdoption = new Set<MigrationVersion>([
  MigrationVersion.Initial,
  MigrationVersion.ExecutionProfiles,
]);

async function legacyApplied(tx: PoolClient, migration: MigrationInput) {
  const found: boolean[] = [];

  for (const table of legacyTables[migration.version]) {
    const result = await tx.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [
      table,
    ]);

    found.push(Boolean(result.rows[0]?.present));
  }

  if (!found.some(Boolean)) {
    return false;
  }

  if (!found.every(Boolean)) {
    throw new Error(MigrationError.LegacySchemaIncomplete);
  }

  return true;
}

export async function applyMigrationJournal(tx: PoolClient, migrations: readonly MigrationInput[]) {
  await tx.query(
    'CREATE TABLE IF NOT EXISTS server_schema_migrations(version text PRIMARY KEY,checksum char(64) NOT NULL,applied_at bigint NOT NULL)',
  );

  for (const migration of migrations) {
    const checksum = digest(migration.sql);

    const saved = (
      await tx.query<{ checksum: string }>('SELECT checksum FROM server_schema_migrations WHERE version=$1', [
        migration.version,
      ])
    ).rows[0];

    if (saved) {
      if (saved.checksum !== checksum) {
        throw new Error(MigrationError.ChecksumMismatch);
      }

      continue;
    }

    const adopted = await legacyApplied(tx, migration);

    if (!adopted || replayOnLegacyAdoption.has(migration.version)) {
      await tx.query(migration.sql);
    }

    await tx.query('INSERT INTO server_schema_migrations(version,checksum,applied_at) VALUES($1,$2,$3)', [
      migration.version,
      checksum,
      Date.now(),
    ]);
  }
}
