import { ServerErrorCode } from '../error-codes.js';
import { ErrorCode } from '../../../../packages/protocol/src/index.js';

import {
  EventType,
  HISTORY_PAGE_MESSAGES,
  HISTORY_CURSOR_MAX_LENGTH,
  eventSchema,
  type EventEnvelope,
} from '../../../../packages/protocol/src/index.js';
import {
  HISTORY_WINDOW_BEFORE_MESSAGES,
  HISTORY_WINDOW_AFTER_MESSAGES,
  HISTORY_CACHE_CURSOR_PREFIX,
  HISTORY_WINDOW_CACHE_VERSION,
} from './limits.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Fault, type Principal } from '../auth/security.js';
import { type Database } from '../db/database.js';
import { type RedisCache } from '../infrastructure/redis.js';

const cursorSchema = z
  .strictObject({
    at: z.number().int().nonnegative(),
    id: z.string().min(1).max(512),
    streamId: z.string().min(1).max(512).optional(),
    seq: z.number().int().nonnegative().optional(),
  })
  .refine((value) => (value.streamId === undefined) === (value.seq === undefined));

type Cursor = z.infer<typeof cursorSchema>;

const pageSchema = z.strictObject({
  events: z.array(eventSchema).max(HISTORY_PAGE_MESSAGES),
  nextCursor: z.string().nullable(),
  afterCursor: z.string().nullable(),
});

export interface HistoryPage {
  events: EventEnvelope[];
  nextCursor: string | null;
  afterCursor: string | null;
}
interface Row {
  data: EventEnvelope;
  event_id: string;
  occurred_at: string;
  stream_id: string;
  seq: string;
}

const encode = (row: Row) =>
  Buffer.from(
    JSON.stringify({
      at: Number(row.occurred_at),
      id: row.event_id,
      streamId: row.stream_id,
      seq: Number(row.seq),
    }),
  ).toString('base64url');

function decode(value: unknown): Cursor | undefined {
  if (value === undefined) {
    return;
  }

  try {
    return cursorSchema.parse(
      JSON.parse(
        Buffer.from(z.string().max(HISTORY_CURSOR_MAX_LENGTH).parse(value), 'base64url').toString('utf8'),
      ),
    );
  } catch {
    throw new Fault(ErrorCode.INVALID_CURSOR);
  }
}

// Native timestamps determine conversation order. Import time only chooses the latest revision of an ID.
const source = `WITH messages AS (
 SELECT DISTINCT ON (coalesce(data->'payload'->>'id',event_id)) data,event_id,stream_id,seq,
 CASE WHEN data->>'type'=$4 AND (data->'payload'->>'occurredAt') ~ '^[0-9]{1,15}$' THEN (data->'payload'->>'occurredAt')::bigint ELSE occurred_at END AS occurred_at
 FROM events WHERE owner_id=$1 AND device_id=$2 AND session_id=$3
 ORDER BY coalesce(data->'payload'->>'id',event_id),events.occurred_at DESC,stream_id DESC,seq DESC,event_id DESC
)`;

const tuple = '(occurred_at,stream_id,seq,event_id)';
const params = (cursor: Cursor) => [cursor.at, cursor.streamId ?? '', cursor.seq ?? 0, cursor.id];

export class SessionHistory {
  constructor(
    private db: Database,
    private cache?: RedisCache,
  ) {}
  async page(
    principal: Principal,
    sessionId: string,
    cursor?: unknown,
    around?: unknown,
    after?: unknown,
  ): Promise<HistoryPage> {
    const session = (
      await this.db.pool.query<{ device_id: string; history_revision: string }>(
        'SELECT s.device_id,d.history_revision FROM sessions s JOIN devices d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL',
        [principal.userId, sessionId],
      )
    ).rows[0];

    if (!session) {
      throw new Fault(ErrorCode.NOT_FOUND, 404);
    }

    const before = decode(cursor),
      newer = decode(after);

    const anchor = around === undefined ? undefined : z.string().min(1).max(512).parse(around);

    if ([before, newer, anchor].filter(Boolean).length > 1) {
      throw new Fault(ErrorCode.INVALID_CURSOR);
    }

    const values = [principal.userId, session.device_id, sessionId, EventType.Message];

    const load = async (): Promise<HistoryPage> => {
      let boundary = before ?? newer;

      if (anchor) {
        const row = (
          await this.db.pool.query<Row>(
            source + ` SELECT * FROM messages WHERE data->'payload'->>'id'=$5 LIMIT 1`,
            [...values, anchor],
          )
        ).rows[0];

        if (row) {
          boundary = {
            at: Number(row.occurred_at),
            id: row.event_id,
            streamId: row.stream_id,
            seq: Number(row.seq),
          };
        }
      }

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
        anchor && boundary
          ? `SELECT * FROM ((SELECT * FROM messages WHERE ${compare}<=${against} ORDER BY ${descending} LIMIT ${HISTORY_WINDOW_BEFORE_MESSAGES}) UNION ALL (SELECT * FROM messages WHERE ${compare}>${against} ORDER BY ${ascending} LIMIT ${HISTORY_WINDOW_AFTER_MESSAGES})) history_window ORDER BY ${ascending}`
          : `SELECT * FROM messages ${boundary ? `WHERE ${compare}${newer ? '>' : '<'}${against}` : ''} ORDER BY ${newer ? ascending : descending} LIMIT ${HISTORY_PAGE_MESSAGES}`;

      let rows = (await this.db.pool.query<Row>(source + ' ' + query, [...values, ...boundValues])).rows;

      if (!(anchor && boundary) && !newer) {
        rows = rows.reverse();
      }

      const first = rows[0],
        last = rows.at(-1);

      const has = async (row: Row, operator: string) =>
        (
          await this.db.pool.query(
            source +
              ` SELECT 1 FROM messages WHERE ${tuple}${operator}($5::bigint,$6::text,$7::bigint,$8::text) LIMIT 1`,
            [...values, Number(row.occurred_at), row.stream_id, Number(row.seq), row.event_id],
          )
        ).rowCount;

      return {
        events: rows.map((row) => ({
          ...row.data,
          payload:
            row.data.type === EventType.Message && row.data.payload && typeof row.data.payload === 'object'
              ? { ...row.data.payload, historyCursor: HISTORY_CACHE_CURSOR_PREFIX + encode(row) }
              : row.data.payload,
        })),
        nextCursor: first && (await has(first, '<')) ? encode(first) : null,
        afterCursor: last && (await has(last, '>')) ? encode(last) : null,
      };
    };

    const key = createHash('sha256')
      .update(
        JSON.stringify([
          HISTORY_WINDOW_CACHE_VERSION,
          principal.userId,
          session.device_id,
          sessionId,
          session.history_revision,
          before,
          newer,
          anchor,
        ]),
      )
      .digest('hex');

    return this.cache
      ? this.cache.remember(
          key,
          (value) => {
            const page = pageSchema.parse(value);

            if (
              page.events.some(
                (event) => event.deviceId !== session.device_id || event.sessionId !== sessionId,
              )
            ) {
              throw new Error(ServerErrorCode.INVALID_CACHED_HISTORY);
            }

            return page;
          },
          load,
        )
      : load();
  }
}
