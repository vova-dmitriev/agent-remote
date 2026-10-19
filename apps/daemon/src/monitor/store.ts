import { DaemonErrorCode } from '../error-codes.js';
import {
  ConnectorId,
  FrameType,
  TargetKind,
  SessionStatus,
  CommandStatus,
  commandSchema,
  sessionSchema,
  type Session,
  type Command,
  type CommandResult,
  type Cursor,
  type EventEnvelope,
  ErrorCode,
  type HistoryRead,
  type ClientCommand,
} from '@protocol';
import { CommandStoreOutcome } from '../domain/runtime.js';
import { cachedLocalHistory } from './local/local-history.js';
import { localCommand } from './local/local-command.js';
import Sqlite from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface NativeSessionRegistration {
  session: Session;
  transcriptPath?: string;
}
export class LocalStore {
  private db: Sqlite.Database;
  constructor(
    path: string,
    private deviceId: string,
  ) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }

    this.db = new Sqlite(path);

    if (path !== ':memory:') {
      chmodSync(path, 0o600);
    }

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');

    this.db.exec(
      'CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,data TEXT NOT NULL,occurred_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL,created_at INTEGER NOT NULL);',
    );

    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES(?,?)').run('streamId', randomUUID());
    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES(?,?)').run('seq', '0');

    this.db.exec(
      'CREATE TABLE IF NOT EXISTS native_sessions(device_id TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,transcript_path TEXT,PRIMARY KEY(device_id,id));',
    );

    this.db.exec(
      'CREATE TABLE IF NOT EXISTS managed_sessions(device_id TEXT NOT NULL,id TEXT NOT NULL,connector_id TEXT NOT NULL,data TEXT NOT NULL,transcript_path TEXT,PRIMARY KEY(device_id,id),UNIQUE(device_id,connector_id));',
    );

    this.recoverCommands();

    this.db.exec(
      'CREATE TABLE IF NOT EXISTS local_command_intents(id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at INTEGER NOT NULL)',
    );
  }
  cursor(): Cursor {
    return {
      streamId: (
        this.db.prepare('SELECT value FROM metadata WHERE key=?').get('streamId') as { value: string }
      ).value,
      seq: Number(
        (this.db.prepare('SELECT value FROM metadata WHERE key=?').get('seq') as { value: string }).value,
      ),
    };
  }
  append(input: Pick<EventEnvelope, 'sessionId' | 'type' | 'payload' | 'occurredAt'>): EventEnvelope {
    return this.db.transaction(() => {
      const cursor = this.cursor();

      const event: EventEnvelope = {
        ...input,
        version: 1,
        deviceId: this.deviceId,
        eventId: randomUUID(),
        streamId: cursor.streamId,
        seq: cursor.seq + 1,
      };

      this.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(String(event.seq), 'seq');

      this.db
        .prepare('INSERT INTO events VALUES(?,?,?)')
        .run(event.seq, JSON.stringify(event), event.occurredAt);

      return event;
    })();
  }
  replay(cursor: Cursor): EventEnvelope[] | typeof FrameType.ResyncRequired {
    const current = this.cursor(),
      min = (this.db.prepare('SELECT min(seq) AS min FROM events').get() as { min: number | null }).min;

    if (
      cursor.streamId !== current.streamId ||
      cursor.seq > current.seq ||
      cursor.seq < (min ?? current.seq + 1) - 1
    ) {
      return FrameType.ResyncRequired;
    }

    return (
      this.db.prepare('SELECT data FROM events WHERE seq>? ORDER BY seq LIMIT 10000').all(cursor.seq) as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data) as EventEnvelope);
  }
  saveManagedSession(input: Session, transcriptPath?: string) {
    const session = sessionSchema.parse(input);

    if (
      session.target.deviceId !== this.deviceId ||
      session.target.connectorId === ConnectorId.Native ||
      ![TargetKind.Cmux, TargetKind.ClaudeCodeCli].some(
        (candidateValue) => candidateValue === session.target.kind,
      ) ||
      !session.claudeSessionId
    ) {
      throw new Error(ErrorCode.NOT_FOUND);
    }

    if (
      transcriptPath !== undefined &&
      (typeof transcriptPath !== 'string' || transcriptPath.length > 4096)
    ) {
      throw new Error(DaemonErrorCode.INVALID_TRANSCRIPT_PATH);
    }

    this.db
      .prepare(
        `INSERT INTO managed_sessions(device_id,id,connector_id,data,transcript_path) VALUES(?,?,?,?,?) ON CONFLICT(device_id,connector_id) DO UPDATE SET id=excluded.id,data=excluded.data,transcript_path=coalesce(excluded.transcript_path,managed_sessions.transcript_path)`,
      )
      .run(
        this.deviceId,
        session.id,
        session.target.connectorId,
        JSON.stringify(session),
        transcriptPath ?? null,
      );
  }
  managedRegistration(connectorId: string): NativeSessionRegistration | undefined {
    const row = this.db
      .prepare('SELECT data,transcript_path FROM managed_sessions WHERE device_id=? AND connector_id=?')
      .get(this.deviceId, connectorId) as { data: string; transcript_path: string | null } | undefined;

    if (!row) {
      return;
    }

    try {
      const session = sessionSchema.parse(JSON.parse(row.data));

      if (
        session.target.deviceId !== this.deviceId ||
        session.target.connectorId !== connectorId ||
        connectorId === ConnectorId.Native ||
        ![TargetKind.Cmux, TargetKind.ClaudeCodeCli].some(
          (candidateValue) => candidateValue === session.target.kind,
        ) ||
        !session.claudeSessionId ||
        session.status === SessionStatus.Ended
      ) {
        return;
      }

      return { session, ...(row.transcript_path ? { transcriptPath: row.transcript_path } : {}) };
    } catch {
      return;
    }
  }
  saveNativeSession(input: Session, transcriptPath?: string) {
    const session = sessionSchema.parse(input);

    if (
      session.target.deviceId !== this.deviceId ||
      session.target.connectorId !== ConnectorId.Native ||
      session.target.kind !== TargetKind.ClaudeCodeCli ||
      !session.claudeSessionId ||
      session.target.claudeSessionId !== session.claudeSessionId
    ) {
      throw new Error(ErrorCode.NOT_FOUND);
    }

    if (
      transcriptPath !== undefined &&
      (typeof transcriptPath !== 'string' || transcriptPath.length > 4096)
    ) {
      throw new Error(DaemonErrorCode.INVALID_TRANSCRIPT_PATH);
    }

    this.db
      .prepare(
        `INSERT INTO native_sessions(device_id,id,data,transcript_path) VALUES(?,?,?,?)
      ON CONFLICT(device_id,id) DO UPDATE SET data=excluded.data,
      transcript_path=COALESCE(excluded.transcript_path,native_sessions.transcript_path)`,
      )
      .run(this.deviceId, session.id, JSON.stringify(session), transcriptPath ?? null);
  }
  nativeSessions(): NativeSessionRegistration[] {
    const rows = this.db
      .prepare('SELECT data,transcript_path FROM native_sessions WHERE device_id=?')
      .all(this.deviceId) as { data: string; transcript_path: string | null }[];

    const registrations: NativeSessionRegistration[] = [];

    for (const row of rows) {
      try {
        const session = sessionSchema.parse(JSON.parse(row.data));

        if (
          session.target.deviceId !== this.deviceId ||
          session.target.connectorId !== ConnectorId.Native ||
          session.target.kind !== TargetKind.ClaudeCodeCli ||
          session.claudeSessionId !== session.target.claudeSessionId
        ) {
          continue;
        }

        registrations.push({
          session,
          ...(row.transcript_path ? { transcriptPath: row.transcript_path } : {}),
        });
      } catch {
        /* Invalid local metadata must not grant a source or command binding. */
      }
    }

    return registrations.sort((a, b) => b.session.lastEventAt - a.session.lastEventAt);
  }
  removeNativeSession(id: string) {
    this.db.prepare('DELETE FROM native_sessions WHERE device_id=? AND id=?').run(this.deviceId, id);
  }
  acknowledgedCursor(): Cursor {
    const current = this.cursor();

    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('ack:' + this.deviceId) as
      { value: string } | undefined;

    if (row) {
      try {
        const saved = JSON.parse(row.value) as Cursor;

        if (
          saved.streamId === current.streamId &&
          Number.isSafeInteger(saved.seq) &&
          saved.seq >= 0 &&
          saved.seq <= current.seq
        ) {
          return saved;
        }
      } catch {
        /* Replay safely from the retained prefix when acknowledgement metadata is invalid. */
      }
    }

    return { streamId: current.streamId, seq: 0 };
  }
  acknowledge(cursor: Cursor) {
    const current = this.cursor();

    if (
      cursor.streamId !== current.streamId ||
      !Number.isSafeInteger(cursor.seq) ||
      cursor.seq <= this.acknowledgedCursor().seq ||
      cursor.seq > current.seq
    ) {
      return;
    }

    this.db
      .prepare(
        'INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run('ack:' + this.deviceId, JSON.stringify(cursor));
  }
  oldestRetainedCursor(): Cursor {
    const current = this.cursor();
    const row = this.db.prepare('SELECT min(seq) AS min FROM events').get() as { min: number | null };

    return { streamId: current.streamId, seq: row.min === null ? current.seq : row.min - 1 };
  }
  replayForSessions(
    cursor: Cursor,
    sessionIds: ReadonlySet<string>,
    limit = 100,
  ): EventEnvelope[] | typeof FrameType.ResyncRequired {
    const current = this.cursor(),
      oldest = this.oldestRetainedCursor();

    if (cursor.streamId !== current.streamId || cursor.seq > current.seq || cursor.seq < oldest.seq) {
      return FrameType.ResyncRequired;
    }

    const ids = [...sessionIds];

    const matches = ids.length
      ? ` OR json_extract(data,'$.sessionId') IN (${ids.map(() => '?').join(',')})`
      : '';

    const rows = this.db
      .prepare(
        `SELECT data FROM events WHERE seq>? AND json_extract(data,'$.deviceId')=?
      AND (json_extract(data,'$.sessionId') IS NULL${matches}) ORDER BY seq LIMIT ?`,
      )
      .all(cursor.seq, this.deviceId, ...ids, Math.max(1, Math.min(10000, limit))) as { data: string }[];

    return rows.map((row) => JSON.parse(row.data) as EventEnvelope);
  }
  prune(now = Date.now()) {
    this.db
      .prepare(
        'DELETE FROM events WHERE occurred_at<? OR seq<=(SELECT COALESCE(max(seq),0)-10000 FROM events)',
      )
      .run(now - 86400000);

    this.db.prepare('DELETE FROM commands WHERE created_at<?').run(now - 86400000);
  }
  begin(command: Command): typeof CommandStoreOutcome.New | CommandResult {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(commandSchema.parse(command)))
      .digest('hex');

    const row = this.db
      .prepare('SELECT fingerprint,result FROM commands WHERE id=?')
      .get(command.commandId) as { fingerprint: string; result: string } | undefined;

    if (row) {
      if (row.fingerprint !== fingerprint) {
        return { commandId: command.commandId, status: CommandStatus.Rejected, code: 'COMMAND_ID_REUSED' };
      }

      return JSON.parse(row.result) as CommandResult;
    }

    this.db
      .prepare('INSERT INTO commands VALUES(?,?,?,?)')
      .run(
        command.commandId,
        fingerprint,
        JSON.stringify({ commandId: command.commandId, status: CommandStatus.Accepted }),
        Date.now(),
      );

    return CommandStoreOutcome.New;
  }
  finish(result: CommandResult) {
    this.db.prepare('UPDATE commands SET result=? WHERE id=?').run(JSON.stringify(result), result.commandId);
  }
  receipt(commandId: string): CommandResult {
    const row = this.db.prepare('SELECT result FROM commands WHERE id=?').get(commandId) as
      { result: string } | undefined;

    if (!row) {
      if (this.hasLocalIntent(commandId)) {
        return { commandId, status: CommandStatus.Unknown, code: ErrorCode.UNFINISHED_DISPATCH };
      }

      throw new Error(ErrorCode.NOT_FOUND);
    }

    return JSON.parse(row.result) as CommandResult;
  }
  localCommand(command: ClientCommand) {
    return localCommand(this.db, command);
  }
  hasLocalIntent(commandId: string) {
    return !!this.db.prepare('SELECT 1 FROM local_command_intents WHERE id=?').get(commandId);
  }
  historyPage(request: Pick<HistoryRead, 'sessionId' | 'direction' | 'anchor'>) {
    return cachedLocalHistory(this.db, this.deviceId, request);
  }
  recoverCommands() {
    const rows = this.db.prepare('SELECT id,result FROM commands').all() as { id: string; result: string }[];

    for (const row of rows) {
      if ((JSON.parse(row.result) as CommandResult).status === CommandStatus.Accepted) {
        this.finish({ commandId: row.id, status: CommandStatus.Unknown, code: 'UNFINISHED_DISPATCH' });
      }
    }
  }
  close() {
    this.db.close();
  }
}
