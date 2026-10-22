import {
  EventType,
  HISTORY_OUTLINE_MESSAGES,
  HISTORY_PAGE_MESSAGES,
  MessageRole,
  type EventEnvelope,
} from '@protocol';
import { and, asc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn, type Database } from '../db/database.js';
import {
  devices,
  events,
  notificationOutbox,
  sessionActivity,
  sessionCatalog,
  sessions,
} from '../db/schema/index.js';
import { HISTORY_WINDOW_AFTER_MESSAGES, HISTORY_WINDOW_BEFORE_MESSAGES } from './limits.js';

export interface HistoryRow extends Record<string, unknown> {
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

/*
 * Message pages use SQL fragments for what the query builder has no form for: DISTINCT ON over a JSON key in a CTE,
 * row-value comparisons for keyset paging, and a UNION ALL window whose halves keep their own ORDER BY and LIMIT.
 * Every value is a bound parameter and every name comes from the schema or a fixed column list.
 */
const payloadId = sql`${events.data}->'payload'->>'id'`;

/** Native timestamps determine conversation order. Import time only chooses the latest revision of an ID. */
const messages = (scope: HistoryScope) => sql`WITH messages AS (
 SELECT DISTINCT ON (coalesce(${payloadId}, ${events.eventId})) ${events.data} AS data, ${events.eventId} AS event_id,
 ${events.streamId} AS stream_id, ${events.seq} AS seq,
 CASE WHEN ${events.data}->>'type'=${EventType.Message} AND (${events.data}->'payload'->>'occurredAt') ~ '^[0-9]{1,15}$'
 THEN (${events.data}->'payload'->>'occurredAt')::bigint ELSE ${events.occurredAt} END AS occurred_at
 FROM ${events}
 WHERE ${events.ownerId}=${scope.ownerId} AND ${events.deviceId}=${scope.deviceId} AND ${events.sessionId}=${scope.sessionId}
 ORDER BY coalesce(${payloadId}, ${events.eventId}), ${events.occurredAt} DESC, ${events.streamId} DESC, ${events.seq} DESC, ${events.eventId} DESC
)`;

const KEYS = ['occurred_at', 'stream_id', 'seq', 'event_id'] as const;
const LEGACY_KEYS = ['occurred_at', 'event_id'] as const;
const ASC = sql`ASC`;
const DESC = sql`DESC`;
const message = sql.identifier('messages');

const columns = (keys: readonly string[]) =>
  sql.join(
    keys.map((key) => sql.identifier(key)),
    sql`, `,
  );

const ordered = (keys: readonly string[], direction: SQL) =>
  sql.join(
    keys.map((key) => sql`${sql.identifier(key)} ${direction}`),
    sql`, `,
  );

/** The boundary as a row value in the same column order as `keys`. */
const position = (boundary: HistoryBoundary, legacy: boolean) =>
  legacy
    ? sql`(${boundary.at}::bigint, ${boundary.id}::text)`
    : sql`(${boundary.at}::bigint, ${boundary.streamId ?? ''}::text, ${boundary.seq ?? 0}::bigint, ${boundary.id}::text)`;

/** Stored device events: persistence, session history pages, replay and retention. */
export class HistoryRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** Stores an event once; returns whether it was new. */
  async insertEvent(tx: PoolClient, ownerId: string, event: EventEnvelope): Promise<boolean> {
    const saved = await ormOn(tx)
      .insert(events)
      .values({
        ownerId,
        deviceId: event.deviceId,
        streamId: event.streamId,
        seq: event.seq,
        eventId: event.eventId,
        sessionId: event.sessionId,
        occurredAt: event.occurredAt,
        data: sql`${JSON.stringify(event)}::jsonb`,
      })
      .onConflictDoNothing()
      .returning({ seq: events.seq });

    return saved.length > 0;
  }

  async bumpRevision(tx: PoolClient, ownerId: string, deviceId: string) {
    await ormOn(tx)
      .update(devices)
      .set({ historyRevision: sql`${devices.historyRevision}+1` })
      .where(and(eq(devices.ownerId, ownerId), eq(devices.id, deviceId)));
  }

  async recordActivity(tx: PoolClient, ownerId: string, deviceId: string, sessionId: string, at: number) {
    await ormOn(tx)
      .insert(sessionActivity)
      .values({ ownerId, deviceId, sessionId, lastMessageAt: at })
      .onConflictDoUpdate({
        target: [sessionActivity.ownerId, sessionActivity.deviceId, sessionActivity.sessionId],
        set: { lastMessageAt: sql`greatest(${sessionActivity.lastMessageAt}, excluded.last_message_at)` },
      });
  }

  async recordNotification(
    tx: PoolClient,
    id: string,
    ownerId: string,
    sessionId: string | null,
    kind: string,
    now: number,
  ) {
    await ormOn(tx)
      .insert(notificationOutbox)
      .values({ id, ownerId, sessionId, kind, createdAt: now, nextAttemptAt: now })
      .onConflictDoNothing();
  }

  /** An owned session on a live device, with that device's history revision. */
  async liveSession(ownerId: string, sessionId: string) {
    const [row] = await this.db.orm
      .select({ device_id: sessions.deviceId, history_revision: devices.historyRevision })
      .from(sessions)
      .innerJoin(devices, and(eq(devices.id, sessions.deviceId), eq(devices.ownerId, sessions.ownerId)))
      .where(and(eq(sessions.ownerId, ownerId), eq(sessions.id, sessionId), isNull(devices.revokedAt)));

    if (row) {
      return row;
    }

    const [catalog] = await this.db.orm
      .select({ device_id: sessionCatalog.deviceId, history_revision: devices.historyRevision })
      .from(sessionCatalog)
      .innerJoin(
        devices,
        and(eq(devices.id, sessionCatalog.deviceId), eq(devices.ownerId, sessionCatalog.ownerId)),
      )
      .where(
        and(
          eq(sessionCatalog.ownerId, ownerId),
          eq(sessionCatalog.id, sessionId),
          eq(sessionCatalog.deviceGeneration, devices.generation),
          isNull(devices.revokedAt),
        ),
      );

    return catalog;
  }

  /** An owned session on a live device, with its stored data. */
  async sourceSession(ownerId: string, sessionId: string): Promise<SourceSessionRow | undefined> {
    const [row] = await this.db.orm
      .select({ device_id: sessions.deviceId, data: sessions.data })
      .from(sessions)
      .innerJoin(devices, and(eq(devices.id, sessions.deviceId), eq(devices.ownerId, sessions.ownerId)))
      .where(and(eq(sessions.ownerId, ownerId), eq(sessions.id, sessionId), isNull(devices.revokedAt)));

    if (row) {
      return row as SourceSessionRow;
    }

    const [catalog] = await this.db.orm
      .select({ device_id: sessionCatalog.deviceId, data: sessionCatalog.data })
      .from(sessionCatalog)
      .innerJoin(
        devices,
        and(eq(devices.id, sessionCatalog.deviceId), eq(devices.ownerId, sessionCatalog.ownerId)),
      )
      .where(
        and(
          eq(sessionCatalog.ownerId, ownerId),
          eq(sessionCatalog.id, sessionId),
          eq(sessionCatalog.deviceGeneration, devices.generation),
          isNull(devices.revokedAt),
        ),
      );

    if (!catalog) {
      return undefined;
    }

    const data = catalog.data as SourceSessionRow['data'];

    return {
      device_id: catalog.device_id,
      data: {
        ...data,
        capabilities: { ...data.capabilities, historyWindow: false, subagentHistory: false },
      },
    };
  }

  /** The latest revision of a message by its payload id. */
  async message(scope: HistoryScope, messageId: string): Promise<HistoryRow | undefined> {
    const result = await this.db.orm.execute<HistoryRow>(
      sql`${messages(scope)} SELECT * FROM ${message} WHERE data->'payload'->>'id'=${messageId} LIMIT 1`,
    );

    return result.rows[0];
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
    const legacy = boundary !== undefined && boundary.streamId === undefined;
    const keys = legacy ? LEGACY_KEYS : KEYS;
    const tuple = sql`(${columns(keys)})`;
    let query: SQL;

    if (anchored && boundary) {
      const at = position(boundary, legacy);

      query = sql`SELECT * FROM ((SELECT * FROM ${message} WHERE ${tuple} <= ${at} ORDER BY ${ordered(keys, DESC)} LIMIT ${HISTORY_WINDOW_BEFORE_MESSAGES})
        UNION ALL (SELECT * FROM ${message} WHERE ${tuple} > ${at} ORDER BY ${ordered(keys, ASC)} LIMIT ${HISTORY_WINDOW_AFTER_MESSAGES})) history_window
        ORDER BY ${ordered(keys, ASC)}`;
    } else {
      const where = boundary
        ? sql`WHERE ${tuple} ${newer ? sql`>` : sql`<`} ${position(boundary, legacy)}`
        : sql``;

      query = sql`SELECT * FROM ${message} ${where} ORDER BY ${ordered(keys, newer ? ASC : DESC)} LIMIT ${HISTORY_PAGE_MESSAGES}`;
    }

    return (await this.db.orm.execute<HistoryRow>(sql`${messages(scope)} ${query}`)).rows;
  }

  /** The newest owner's messages, tool lines left out, oldest first. */
  async outline(scope: HistoryScope): Promise<HistoryRow[]> {
    const result = await this.db.orm.execute<HistoryRow>(
      sql`${messages(scope)} SELECT * FROM ${message} WHERE data->>'type'=${EventType.Message}
        AND data->'payload'->>'role'=${MessageRole.User} AND data->'payload'->'tool' IS NULL
        ORDER BY ${ordered(KEYS, DESC)} LIMIT ${HISTORY_OUTLINE_MESSAGES}`,
    );

    return result.rows.reverse();
  }

  /** The session's newest stored messages, oldest first. */
  async recent(scope: HistoryScope, limit: number): Promise<HistoryRow[]> {
    const result = await this.db.orm.execute<HistoryRow>(
      sql`${messages(scope)} SELECT * FROM ${message} WHERE data->>'type'=${EventType.Message}
        ORDER BY ${ordered(KEYS, DESC)} LIMIT ${limit}`,
    );

    return result.rows.reverse();
  }

  /** Whether any message lies beyond a row in the given direction (`<` older, `>` newer). */
  async beyond(scope: HistoryScope, row: HistoryRow, operator: '<' | '>'): Promise<boolean> {
    const at = position(
      { at: Number(row.occurred_at), streamId: row.stream_id, seq: Number(row.seq), id: row.event_id },
      false,
    );

    const result = await this.db.orm.execute(
      sql`${messages(scope)} SELECT 1 FROM ${message} WHERE (${columns(KEYS)}) ${operator === '<' ? sql`<` : sql`>`} ${at} LIMIT 1`,
    );

    return result.rows.length > 0;
  }

  async streamBounds(ownerId: string, deviceId: string, streamId: string) {
    const [row] = await this.db.orm
      .select({ min: sql<string>`min(${events.seq})::text`, max: sql<string>`max(${events.seq})::text` })
      .from(events)
      .where(and(eq(events.ownerId, ownerId), eq(events.deviceId, deviceId), eq(events.streamId, streamId)));

    return row;
  }

  /** Up to 100 events of a stream after a sequence number, in order. */
  async after(ownerId: string, deviceId: string, streamId: string, seq: number): Promise<EventEnvelope[]> {
    const rows = await this.db.orm
      .select({ data: events.data })
      .from(events)
      .where(
        and(
          eq(events.ownerId, ownerId),
          eq(events.deviceId, deviceId),
          eq(events.streamId, streamId),
          gt(events.seq, seq),
        ),
      )
      .orderBy(asc(events.seq))
      .limit(100);

    return rows.map((row) => row.data as EventEnvelope);
  }

  /** Every device, revoked ones included, that holds at least one event. */
  async deviceIds(): Promise<string[]> {
    const rows = await this.db.orm
      .select({ id: devices.id })
      .from(devices)
      .where(sql`EXISTS (SELECT 1 FROM ${events} WHERE ${events.deviceId}=${devices.id})`);

    return rows.map((row) => row.id);
  }

  /** Drops up to `limit` of a device's events older than `before`, through `events_retention`; returns how many. */
  async pruneOlder(deviceId: string, before: number, limit: number): Promise<number> {
    const result = await this.db.orm.execute(
      sql`DELETE FROM ${events} WHERE ctid IN (SELECT ctid FROM ${events} WHERE ${events.deviceId}=${deviceId} AND ${events.occurredAt}<${before} LIMIT ${limit})`,
    );

    return result.rowCount ?? 0;
  }

  /** Drops up to `limit` of a device's events beyond its newest `keep`, through `events_retention`; returns how many. */
  async pruneSurplus(deviceId: string, keep: number, limit: number): Promise<number> {
    const result = await this.db.orm.execute(
      sql`DELETE FROM ${events} WHERE ctid IN (SELECT ctid FROM ${events} WHERE ${events.deviceId}=${deviceId} ORDER BY ${events.occurredAt} DESC OFFSET ${keep} LIMIT ${limit})`,
    );

    return result.rowCount ?? 0;
  }
}
