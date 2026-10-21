import { chmodSync } from 'node:fs';
import Sqlite from 'better-sqlite3';
import type { RateLimit } from '@protocol';
import type { CodexFileState } from './parsers/codex-usage.js';
import type { UsageRow } from './parsers/usage-row.js';

/** Bump when a table, a key or the price table changes: the store is then rebuilt from the transcripts. */
const SCHEMA_VERSION = '1';

const COLUMNS = [
  'provider',
  'key',
  'session_id',
  'project',
  'model',
  'at_ms',
  'day',
  'input',
  'output',
  'cache_read',
  'cache_write',
  'cache_write_long',
  'cost',
];

const TABLES = `
  CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, inode INTEGER, "offset" INTEGER, state TEXT);
  CREATE TABLE IF NOT EXISTS usage (
    provider TEXT, key TEXT, session_id TEXT, project TEXT, model TEXT, at_ms INTEGER, day TEXT,
    input INTEGER, output INTEGER, cache_read INTEGER, cache_write INTEGER, cache_write_long INTEGER, cost REAL,
    PRIMARY KEY (provider, key)
  );
  CREATE INDEX IF NOT EXISTS usage_at ON usage (at_ms);
  CREATE INDEX IF NOT EXISTS usage_session ON usage (session_id);
`;

// Claude repeats a request's usage on each record, its output growing as the reply streams; the same request can
// also sit in two transcripts after a resume. The record with the most output wins, whatever the read order.
const UPSERT = `INSERT INTO usage (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})
  ON CONFLICT (provider, key) DO UPDATE SET ${COLUMNS.slice(2)
    .map((name) => `${name} = excluded.${name}`)
    .join(', ')}
  WHERE excluded.output >= usage.output`;

/** Where a transcript was read up to, so the next pass reads only what was appended. */
export interface StoredFile {
  path: string;
  inode: number;
  offset: number;
  state: CodexFileState;
}

export interface StoredLimits {
  at: number;
  limits: RateLimit[];
}

type Row = Record<string, unknown>;

/** The daemon's token usage store: one SQLite file beside its state, written only by this process. */
export class UsageStore {
  private latest: StoredLimits | undefined;
  private readonly upsert: Sqlite.Statement;

  private constructor(private readonly db: Sqlite.Database) {
    db.pragma('journal_mode = WAL');
    db.exec(TABLES);

    const [version] = this.query("SELECT value FROM meta WHERE name = 'schema'");

    if (version?.value !== SCHEMA_VERSION) {
      db.exec('DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS usage; DROP TABLE IF EXISTS meta;');
      db.exec(TABLES);
      db.prepare("INSERT INTO meta VALUES ('schema', ?)").run(SCHEMA_VERSION);
    }

    const [limits] = this.query("SELECT value FROM meta WHERE name = 'limits'");

    this.latest = typeof limits?.value === 'string' ? (JSON.parse(limits.value) as StoredLimits) : undefined;
    this.upsert = db.prepare(UPSERT);
  }

  static open(path: string) {
    const db = new Sqlite(path);

    chmodSync(path, 0o600);

    return new UsageStore(db);
  }

  query(sql: string, values: readonly unknown[] = []): Row[] {
    return this.db.prepare(sql).all(...values) as Row[];
  }

  files() {
    return new Map(
      this.query('SELECT path, inode, "offset", state FROM files').map((row) => [
        String(row.path),
        {
          path: String(row.path),
          inode: Number(row.inode),
          offset: Number(row.offset),
          state: JSON.parse(String(row.state)) as CodexFileState,
        },
      ]),
    );
  }

  limits() {
    return this.latest?.limits ?? [];
  }

  /** Rows from one read of `file`, its new offset and the rate limits it reported, in one transaction. */
  save(rows: readonly UsageRow[], file: StoredFile, limits?: StoredLimits) {
    const newer = limits && limits.at >= (this.latest?.at ?? 0) ? limits : undefined;

    this.db.transaction(() => {
      for (const row of rows) {
        this.upsert.run(
          row.provider,
          row.key,
          row.sessionId,
          row.project,
          row.model,
          row.at,
          row.day,
          row.input,
          row.output,
          row.cacheRead,
          row.cacheWrite,
          row.cacheWriteLong,
          row.costUsd,
        );
      }

      this.db
        .prepare('INSERT OR REPLACE INTO files VALUES (?, ?, ?, ?)')
        .run(file.path, file.inode, file.offset, JSON.stringify(file.state));

      if (newer) {
        this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('limits', ?)").run(JSON.stringify(newer));
      }
    })();

    if (newer) {
      this.latest = newer;
    }
  }

  close() {
    this.db.close();
  }
}
