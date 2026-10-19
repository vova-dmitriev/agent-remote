import { z } from 'zod';
import type Sqlite from 'better-sqlite3';
import {
  CodedError,
  ErrorCode,
  type EventEnvelope,
  EventType,
  HistoryCursorPrefix,
  HistoryDirection,
  type HistoryRead,
} from '@protocol';
import { bytePage } from '../../local/history/index.js';

const cursorSchema = z.strictObject({ at: z.number().nonnegative(), seq: z.number().int().nonnegative() });
const pageSize = 30;

interface Row {
  data: string;
  seq: number;
  at: number;
}

const cursor = (row: Row) =>
  HistoryCursorPrefix.Cache + Buffer.from(JSON.stringify({ at: row.at, seq: row.seq })).toString('base64url');

export function cachedLocalHistory(
  db: Sqlite.Database,
  deviceId: string,
  request: Pick<HistoryRead, 'sessionId' | 'direction' | 'anchor'>,
) {
  const base = `WITH messages AS (SELECT data,seq,json_extract(data,'$.payload.occurredAt') AS at, row_number() OVER (PARTITION BY json_extract(data,'$.payload.id') ORDER BY seq DESC) AS rank FROM events WHERE json_extract(data,'$.deviceId')=? AND json_extract(data,'$.sessionId')=? AND json_extract(data,'$.type')=?) SELECT data,seq,at FROM messages WHERE rank=1`;
  const args: (string | number)[] = [deviceId, request.sessionId, EventType.Message];
  let query = base;

  if (request.direction === HistoryDirection.Before || request.direction === HistoryDirection.After) {
    let anchor: z.infer<typeof cursorSchema>;

    try {
      if (!request.anchor?.startsWith(HistoryCursorPrefix.Cache)) {
        throw new CodedError(ErrorCode.INVALID_CURSOR);
      }

      anchor = cursorSchema.parse(
        JSON.parse(
          Buffer.from((request.anchor ?? '').slice(HistoryCursorPrefix.Cache.length), 'base64url').toString(),
        ),
      );
    } catch {
      throw new CodedError(ErrorCode.INVALID_CURSOR);
    }

    const comparison = request.direction === HistoryDirection.Before ? '<' : '>';

    query += ` AND (at${comparison}? OR (at=? AND seq${comparison}?))`;
    args.push(anchor.at, anchor.at, anchor.seq);
  } else if (request.direction === HistoryDirection.Around && request.anchor) {
    const found = db
      .prepare(base + ` AND json_extract(data,'$.payload.id')=? LIMIT 1`)
      .get(...args, request.anchor) as Row | undefined;

    if (found) {
      const earlier = db
        .prepare(base + ' AND (at<? OR (at=? AND seq<=?)) ORDER BY at DESC,seq DESC LIMIT 16')
        .all(...args, found.at, found.at, found.seq) as Row[];

      const later = db
        .prepare(base + ' AND (at>? OR (at=? AND seq>?)) ORDER BY at ASC,seq ASC LIMIT 16')
        .all(...args, found.at, found.at, found.seq) as Row[];

      return page(
        [...earlier.slice(0, 15).reverse(), ...later.slice(0, 15)],
        earlier.length > 15,
        later.length > 15,
        request,
      );
    }
  }

  const ascending = request.direction === HistoryDirection.After;

  const rows = db
    .prepare(query + ` ORDER BY at ${ascending ? 'ASC' : 'DESC'},seq ${ascending ? 'ASC' : 'DESC'} LIMIT ?`)
    .all(...args, pageSize + 1) as Row[];

  const more = rows.length > pageSize;
  const selected = rows.slice(0, pageSize);

  return page(
    ascending ? selected : selected.reverse(),
    ascending || more,
    !ascending ? request.direction !== HistoryDirection.Latest : more,
    request,
  );
}

function page(
  rows: Row[],
  before: boolean,
  after: boolean,
  request: Pick<HistoryRead, 'direction' | 'anchor'>,
) {
  const events = rows.map((row) => JSON.parse(row.data) as EventEnvelope);
  const anchor = events.findIndex((event) => (event.payload as { id?: string }).id === request.anchor);

  const { start, end } = bytePage(events, request.direction, anchor);

  return {
    events: events.slice(start, end),
    before: (before || start > 0) && end > start ? cursor(rows[start]!) : null,
    after: (after || end < rows.length) && end > start ? cursor(rows[end - 1]!) : null,
  };
}
