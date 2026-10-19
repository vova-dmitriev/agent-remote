import { EventType, HISTORY_PAGE_MESSAGES, type EventEnvelope } from '@protocol';
import type { PoolClient } from 'pg';
import type { Database } from '../db/database.js';
import { HISTORY_WINDOW_AFTER_MESSAGES, HISTORY_WINDOW_BEFORE_MESSAGES } from './limits.js';

export interface HistoryRow {
  data: EventEnvelope;
  event_id: string;
  occurred_at: string;
  stream_id: string;
  seq: string;
}

/** A page boundary; a legacy boundary has no stream position. */
export interface HistoryBoundary {
  at: number;
  id: string;
  streamId?: string | undefined;
  seq?: number | undefined;
}

export interface HistoryScope {
  ownerId: string;
  deviceId: string;
  sessionId: string;
}

export interface SourceSessionRow {
  device_id: string;
  data: { generation: string; capabilities?: { historyWindow?: boolean; subagentHistory?: boolean } };
}

// Native timestamps determine conversation order. Import time only chooses the latest revision of an ID.
const source = `WITH messages AS (
 SELECT DISTINCT ON (coalesce(data->'payload'->>'id',event_id)) data,event_id,stream_id,seq,
 CASE WHEN data->>'type'=$4 AND (data->'payload'->>'occurredAt') ~ '^[0-9]{1,15}$' THEN (data->'payload'->>'occurredAt')::bigint ELSE occurred_at END AS occurred_at
 FROM events WHERE owner_id=$1 AND device_id=$2 AND session_id=$3
 ORDER BY coalesce(data->'payload'->>'id',event_id),events.occurred_at DESC,stream_id DESC,seq DESC,event_id DESC
)`;

const tuple = '(occurred_at,stream_id,seq,event_id)';
const params = (cursor: HistoryBoundary) => [cursor.at, cursor.streamId ?? '', cursor.seq ?? 0, cursor.id];
const scoped = (scope: HistoryScope) => [scope.ownerId, scope.deviceId, scope.sessionId, EventType.Message];

/** Stored device events: persistence, session history pages, replay and retention. */
export class HistoryRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** Stores an event once; returns whether it was new. */
  async insertEvent(tx: PoolClient, ownerId: string, event: EventEnvelope): Promise<boolean> {
    const saved = await tx.query(
      'INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,session_id,occurred_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING seq',
      [
        ownerId,
        event.deviceId,
        event.streamId,
        event.seq,
        event.eventId,
        event.sessionId,
        event.occurredAt,
        JSON.stringify(event),
      ],
    );

    return Boolean(saved.rowCount);
  }

  async bumpRevision(tx: PoolClient, ownerId: string, deviceId: string) {
    await tx.query('UPDATE devices SET history_revision=history_revision+1 WHERE owner_id=$1 AND id=$2', [
      ownerId,
      deviceId,
    ]);
  }

  async recordActivity(tx: PoolClient, ownerId: string, deviceId: string, sessionId: string, at: number) {
    await tx.query(
      'INSERT INTO session_activity(owner_id,device_id,session_id,last_message_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,device_id,session_id) DO UPDATE SET last_message_at=greatest(session_activity.last_message_at,EXCLUDED.last_message_at)',
      [ownerId, deviceId, sessionId, at],
    );
  }

  async recordNotification(
    tx: PoolClient,
    id: string,
    ownerId: string,
    sessionId: string | null,
    kind: string,
    now: number,
  ) {
    await tx.query(
      'INSERT INTO notification_outbox(id,owner_id,session_id,kind,created_at,next_attempt_at) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT DO NOTHING',
      [id, ownerId, sessionId, kind, now],
    );
  }

  /** An owned session on a live device, with that device's history revision. */
  async liveSession(ownerId: string, sessionId: string) {
    return (
      await this.db.pool.query<{ device_id: string; history_revision: string }>(
        'SELECT s.device_id,d.history_revision FROM sessions s JOIN devices d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL',
        [ownerId, sessionId],
      )
    ).rows[0];
  }

  /** An owned session on a live device, with its stored data. */
  async sourceSession(ownerId: string, sessionId: string): Promise<SourceSessionRow | undefined> {
    return (
      await this.db.pool.query<SourceSessionRow>(
        'SELECT s.device_id,s.data FROM sessions s JOIN devices d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL',
        [ownerId, sessionId],
      )
    ).rows[0];
  }

  /** The latest revision of a message by its payload id. */
  async message(scope: HistoryScope, messageId: string): Promise<HistoryRow | undefined> {
    return (
      await this.db.pool.query<HistoryRow>(
        source + ` SELECT * FROM messages WHERE data->'payload'->>'id'=$5 LIMIT 1`,
        [...scoped(scope), messageId],
      )
    ).rows[0];
  }

  /**
   * One page of messages: around an anchored boundary, after a boundary when `newer`, else before it (or the latest).
   * A page before a boundary comes newest first.
   */
  async page(
    scope: HistoryScope,
    boundary: HistoryBoundary | undefined,
    anchored: boolean,
    newer: boolean,
  ): Promise<HistoryRow[]> {
    const legacy = boundary && boundary.streamId === undefined;
    const compare = legacy ? '(occurred_at,event_id)' : tuple;
    const against = legacy ? '($5::bigint,$6::text)' : '($5::bigint,$6::text,$7::bigint,$8::text)';
    let boundValues: (string | number)[] = [];

    if (boundary) {
      boundValues = legacy ? [boundary.at, boundary.id] : params(boundary);
    }

    const order = legacy ? 'occurred_at,event_id' : 'occurred_at,stream_id,seq,event_id';

    const descending = order
      .split(',')
      .map((key) => key + ' DESC')
      .join(',');

    const ascending = order
      .split(',')
      .map((key) => key + ' ASC')
      .join(',');

    const query =
      anchored && boundary
        ? `SELECT * FROM ((SELECT * FROM messages WHERE ${compare}<=${against} ORDER BY ${descending} LIMIT ${HISTORY_WINDOW_BEFORE_MESSAGES}) UNION ALL (SELECT * FROM messages WHERE ${compare}>${against} ORDER BY ${ascending} LIMIT ${HISTORY_WINDOW_AFTER_MESSAGES})) history_window ORDER BY ${ascending}`
        : `SELECT * FROM messages ${boundary ? `WHERE ${compare}${newer ? '>' : '<'}${against}` : ''} ORDER BY ${newer ? ascending : descending} LIMIT ${HISTORY_PAGE_MESSAGES}`;

    return (await this.db.pool.query<HistoryRow>(source + ' ' + query, [...scoped(scope), ...boundValues]))
      .rows;
  }

  /** Whether any message lies beyond a row in the given direction (`<` older, `>` newer). */
  async beyond(scope: HistoryScope, row: HistoryRow, operator: string): Promise<boolean> {
    return Boolean(
      (
        await this.db.pool.query(
          source +
            ` SELECT 1 FROM messages WHERE ${tuple}${operator}($5::bigint,$6::text,$7::bigint,$8::text) LIMIT 1`,
          [...scoped(scope), Number(row.occurred_at), row.stream_id, Number(row.seq), row.event_id],
        )
      ).rowCount,
    );
  }

  async streamBounds(ownerId: string, deviceId: string, streamId: string) {
    return (
      await this.db.pool.query<{ min: string; max: string }>(
        'SELECT min(seq)::text AS min,max(seq)::text AS max FROM events WHERE owner_id=$1 AND device_id=$2 AND stream_id=$3',
        [ownerId, deviceId, streamId],
      )
    ).rows[0];
  }

  /** Up to 100 events of a stream after a sequence number, in order. */
  async after(ownerId: string, deviceId: string, streamId: string, seq: number): Promise<EventEnvelope[]> {
    return (
      await this.db.pool.query<{ data: EventEnvelope }>(
        'SELECT data FROM events WHERE owner_id=$1 AND device_id=$2 AND stream_id=$3 AND seq>$4 ORDER BY seq LIMIT 100',
        [ownerId, deviceId, streamId, seq],
      )
    ).rows.map((row) => row.data);
  }

  /** Drops events older than `before` and all but each device's latest 10 000. */
  async prune(before: number) {
    await this.db.pool.query(
      'DELETE FROM events WHERE occurred_at<$1 OR ctid IN (SELECT ctid FROM (SELECT ctid,row_number() OVER(PARTITION BY device_id ORDER BY occurred_at DESC) AS rank FROM events) e WHERE rank>10000)',
      [before],
    );
  }
}
