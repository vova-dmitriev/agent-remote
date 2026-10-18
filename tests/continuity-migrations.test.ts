import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../apps/server/src/db/database.js';

const fixtures: { db: Database; admin: Pool; schema: string }[] = [];

async function fixture(legacyThrough = 0) {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test';

  const schema = `continuity_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url });

  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = new Database(url, schema);

  fixtures.push({ db, admin, schema });

  if (legacyThrough > 0) {
    const migrations = ['001_initial.sql', '002_execution_profiles.sql', '003_continuity.sql'];

    for (const file of migrations.slice(0, legacyThrough)) {
      await db.pool.query(
        await readFile(new URL(`../apps/server/src/db/migrations/${file}`, import.meta.url), 'utf8'),
      );
    }
  }

  return db;
}

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async ({ db, admin, schema }) => {
      await db.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }),
  );
});

describe('ordered PostgreSQL migration journal', () => {
  it('finishes legacy core-table adoption without losing rows or skipping appended schema', async () => {
    const db = await fixture();

    await db.pool.query(`
      CREATE TABLE users (id text PRIMARY KEY, telegram_id text NOT NULL UNIQUE, created_at bigint NOT NULL,
        private_chat_id text, notifications_enabled boolean NOT NULL DEFAULT true);
      CREATE TABLE devices (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id),
        token_hash text NOT NULL UNIQUE, generation text NOT NULL, revoked_at bigint,
        last_seen_at bigint NOT NULL DEFAULT 0, snapshot jsonb, connectors jsonb NOT NULL DEFAULT '[]',
        UNIQUE(owner_id,id));
      CREATE TABLE sessions (owner_id text NOT NULL, device_id text NOT NULL, id text NOT NULL,
        data jsonb NOT NULL, PRIMARY KEY(owner_id,device_id,id),
        FOREIGN KEY(owner_id,device_id) REFERENCES devices(owner_id,id) ON DELETE CASCADE);
      CREATE TABLE events (owner_id text NOT NULL, device_id text NOT NULL, stream_id text NOT NULL,
        seq bigint NOT NULL, event_id text NOT NULL, session_id text, occurred_at bigint NOT NULL,
        data jsonb NOT NULL, PRIMARY KEY(owner_id,device_id,stream_id,seq),
        UNIQUE(owner_id,device_id,event_id),
        FOREIGN KEY(owner_id,device_id) REFERENCES devices(owner_id,id) ON DELETE CASCADE);
      CREATE TABLE execution_profile_metadata (owner_id text NOT NULL, device_id text NOT NULL, data jsonb NOT NULL,
        PRIMARY KEY(owner_id,device_id), FOREIGN KEY(owner_id,device_id) REFERENCES devices(owner_id,id) ON DELETE CASCADE);
      INSERT INTO users(id,telegram_id,created_at) VALUES('legacy-owner','legacy-telegram',1);
      INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('legacy-device','legacy-owner','legacy-token','legacy-generation');
      INSERT INTO sessions(owner_id,device_id,id,data) VALUES('legacy-owner','legacy-device','legacy-session','{}');
      INSERT INTO execution_profile_metadata(owner_id,device_id,data)
        VALUES('legacy-owner','legacy-device','{"preferred":null}');
      INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,session_id,occurred_at,data)
        VALUES('legacy-owner','legacy-device','legacy-stream',1,'legacy-event','legacy-session',123,
          '{"type":"message","payload":{"occurredAt":123}}');
    `);

    await db.migrate();

    const rows = await db.pool.query(`
      SELECT u.id AS owner, d.id AS device, s.id AS session, e.event_id
      FROM users u JOIN devices d ON d.owner_id=u.id
      JOIN sessions s ON s.owner_id=u.id AND s.device_id=d.id
      JOIN events e ON e.owner_id=u.id AND e.device_id=d.id AND e.session_id=s.id
    `);

    expect(rows.rows).toEqual([
      { owner: 'legacy-owner', device: 'legacy-device', session: 'legacy-session', event_id: 'legacy-event' },
    ]);

    const tables = await db.pool.query(
      "SELECT to_regclass('browser_sessions') AS browser_sessions,to_regclass('reading_positions') AS reading_positions,to_regclass('attachment_blobs') AS attachment_blobs",
    );

    expect(Object.values(tables.rows[0]).every(Boolean)).toBe(true);

    const columns = await db.pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name IN ('auth_sessions','attachments','command_audit','devices')",
    );

    const columnNames = new Set(columns.rows.map((row) => row.column_name));

    expect(
      [
        'browser_session_hash',
        'blob_sha256',
        'device_export',
        'source_message_id',
        'source_position',
        'result_session_id',
        'history_revision',
      ].every((name) => columnNames.has(name)),
    ).toBe(true);

    const backfill = await db.pool.query(
      'SELECT session_id,last_message_at FROM session_activity WHERE owner_id=$1 AND device_id=$2',
      ['legacy-owner', 'legacy-device'],
    );

    expect(backfill.rows).toEqual([{ session_id: 'legacy-session', last_message_at: '123' }]);

    const metadata = await db.pool.query(
      'SELECT data FROM execution_profile_metadata WHERE owner_id=$1 AND device_id=$2',
      ['legacy-owner', 'legacy-device'],
    );

    expect(metadata.rows).toEqual([{ data: { preferred: null } }]);
  });

  it('adopts legacy 001/002 and applies continuity plus proof metadata', async () => {
    const db = await fixture(2);

    await db.migrate();
    const rows = await db.pool.query('SELECT version FROM server_schema_migrations ORDER BY version');

    expect(rows.rows.map((row) => row.version)).toEqual([
      '001_initial',
      '002_execution_profiles',
      '003_continuity',
      '004_continuity_command_proofs',
      '005_handoff_create_evidence',
      '006_attachment_cache',
    ]);

    expect(
      (await db.pool.query("SELECT to_regclass('continuity_conversations') AS table")).rows[0].table,
    ).toBeTruthy();
  });

  it('adopts legacy continuity at 003 and applies the proof migration', async () => {
    const db = await fixture(3);

    await db.migrate();
    const rows = await db.pool.query('SELECT version FROM server_schema_migrations ORDER BY version');

    expect(rows.rows.map((row) => row.version)).toEqual([
      '001_initial',
      '002_execution_profiles',
      '003_continuity',
      '004_continuity_command_proofs',
      '005_handoff_create_evidence',
      '006_attachment_cache',
    ]);

    expect(
      (await db.pool.query("SELECT to_regclass('handoff_seed_proofs') AS table")).rows[0].table,
    ).toBeTruthy();

    const evidence = await db.pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='command_audit'",
    );

    expect(evidence.rows.map((row) => row.column_name)).toContain('create_selection');
  });

  it('repeats safely, rejects checksum drift, and serializes concurrent migration runs', async () => {
    const db = await fixture();

    await Promise.all([db.migrate(), db.migrate()]);
    await db.migrate();

    await db.pool.query(
      "UPDATE server_schema_migrations SET checksum='bad' WHERE version='002_execution_profiles'",
    );

    await expect(db.migrate()).rejects.toThrow('MIGRATION_CHECKSUM_MISMATCH');
  });
});
