import { ServerErrorCode } from '../error-codes.js';
import {
  ErrorCode,
  EventType,
  HISTORY_PAGE_MESSAGES,
  HISTORY_CURSOR_MAX_LENGTH,
  eventSchema,
  outlineMessages,
  type EventEnvelope,
  type HistoryMessage,
} from '@protocol';

import { HISTORY_CACHE_CURSOR_PREFIX, HISTORY_WINDOW_CACHE_VERSION } from './limits.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { type Principal } from '../auth/security.js';
import { Fault } from '../http/errors/fault.js';
import { type RedisCache } from '../infrastructure/redis.js';
import { type HistoryRepository, type HistoryRow } from './repository.js';

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

const encode = (row: HistoryRow) =>
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

export class SessionHistory {
  constructor(
    private repository: HistoryRepository,
    private cache?: RedisCache,
  ) {}
  /** Every stored owner's message of a session, for the message rail. */
  async outline(principal: Principal, sessionId: string): Promise<HistoryMessage[]> {
    const session = await this.repository.liveSession(principal.userId, sessionId);

    if (!session) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    const rows = await this.repository.outline({
      ownerId: principal.userId,
      deviceId: session.device_id,
      sessionId,
    });

    return outlineMessages(rows.map((row) => row.data.payload as HistoryMessage));
  }
  async page(
    principal: Principal,
    sessionId: string,
    cursor?: unknown,
    around?: unknown,
    after?: unknown,
  ): Promise<HistoryPage> {
    const { repository } = this;
    const session = await repository.liveSession(principal.userId, sessionId);

    if (!session) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    const before = decode(cursor),
      newer = decode(after);

    const anchor = around === undefined ? undefined : z.string().min(1).max(512).parse(around);

    if ([before, newer, anchor].filter(Boolean).length > 1) {
      throw new Fault(ErrorCode.INVALID_CURSOR);
    }

    const scope = { ownerId: principal.userId, deviceId: session.device_id, sessionId };

    const load = async (): Promise<HistoryPage> => {
      let boundary = before ?? newer;

      if (anchor) {
        const row = await repository.message(scope, anchor);

        if (row) {
          boundary = {
            at: Number(row.occurred_at),
            id: row.event_id,
            streamId: row.stream_id,
            seq: Number(row.seq),
          };
        }
      }

      let rows = await repository.page(scope, boundary, Boolean(anchor), Boolean(newer));

      if (!(anchor && boundary) && !newer) {
        rows = rows.reverse();
      }

      const first = rows[0],
        last = rows.at(-1);

      const has = (row: HistoryRow, operator: '<' | '>') => repository.beyond(scope, row, operator);

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
