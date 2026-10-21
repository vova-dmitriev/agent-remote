import {
  AgentProvider,
  CodedError,
  ErrorCode,
  ProviderFilterValue,
  SessionListLimits,
  sessionSchema,
  type Session,
} from '@protocol';
import type Sqlite from 'better-sqlite3';
import { z } from 'zod';

interface Cursor {
  deviceId: string;
  provider: ProviderFilterValue;
  recency: number;
  id: string;
}

export interface SessionListPage {
  sessions: Session[];
  nextCursor: string | null;
}

const cursorSchema = z.strictObject({
  deviceId: z.string().min(1).max(512),
  provider: z.enum(ProviderFilterValue),
  id: sessionSchema.shape.id,
  recency: z.number().int().nonnegative().safe(),
});

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function sessionListCursor(deviceId: string, provider: ProviderFilterValue, session: Session) {
  return encodeCursor({ deviceId, provider, id: session.id, recency: recencyOf(session) });
}

function decodeCursor(value: string | undefined, deviceId: string, provider: ProviderFilterValue) {
  if (value === undefined) {
    return undefined;
  }

  try {
    if (value.length > SessionListLimits.DeviceCursorLength) {
      throw new Error();
    }

    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const parsed = cursorSchema.safeParse(decoded);

    if (!parsed.success || parsed.data.deviceId !== deviceId || parsed.data.provider !== provider) {
      throw new Error();
    }

    return parsed.data as Cursor;
  } catch {
    throw new CodedError(ErrorCode.INVALID_CURSOR);
  }
}

function providerOf(session: Session) {
  return session.target.kind.startsWith('codex-') ? AgentProvider.Codex : AgentProvider.Claude;
}

function recencyOf(session: Session) {
  return session.lastMessageAt ?? session.createdAt ?? 0;
}

export function saveListedSession(db: Sqlite.Database, deviceId: string, input: Session) {
  const session = sessionSchema.parse(input);

  if (session.target.deviceId !== deviceId) {
    throw new CodedError(ErrorCode.NOT_FOUND);
  }

  db.prepare(
    'INSERT INTO listed_sessions(device_id,id,provider,recency_at,data) VALUES(?,?,?,?,?) ON CONFLICT(device_id,id) DO UPDATE SET provider=excluded.provider,recency_at=excluded.recency_at,data=excluded.data',
  ).run(
    deviceId,
    session.id,
    providerOf(session),
    recencyOf(session),
    JSON.stringify({
      ...session,
      currentActivity: undefined,
      changes: undefined,
      usage: undefined,
      subagents: undefined,
      nativeRestartState: undefined,
    }),
  );
}

export function pageListedSessions(
  db: Sqlite.Database,
  deviceId: string,
  provider: ProviderFilterValue,
  cursorValue?: string,
): SessionListPage {
  const cursor = decodeCursor(cursorValue, deviceId, provider);
  const providerClause = provider === ProviderFilterValue.All ? '' : ' AND provider=?';
  const cursorClause = cursor ? ' AND (recency_at<? OR (recency_at=? AND id>?))' : '';

  const hiddenClause =
    ' AND NOT EXISTS (SELECT 1 FROM session_hidden hidden WHERE hidden.device_id=listed_sessions.device_id AND hidden.id=listed_sessions.id AND listed_sessions.recency_at<=hidden.hidden_at)';

  const values: (string | number)[] = [deviceId];

  if (provider !== ProviderFilterValue.All) {
    values.push(provider.toLowerCase());
  }

  if (cursor) {
    values.push(cursor.recency, cursor.recency, cursor.id);
  }

  values.push(SessionListLimits.PageSize + 1);

  const rows = db
    .prepare(
      `SELECT id,data,recency_at,EXISTS (SELECT 1 FROM session_pins pins WHERE pins.device_id=listed_sessions.device_id AND pins.id=listed_sessions.id) AS pinned FROM listed_sessions WHERE device_id=?${providerClause}${hiddenClause}${cursorClause} ORDER BY recency_at DESC,id ASC LIMIT ?`,
    )
    .all(...values) as { id: string; data: string; recency_at: number; pinned: number }[];

  const hasMore = rows.length > SessionListLimits.PageSize;

  const page = rows.slice(0, SessionListLimits.PageSize).map((row) => {
    const session = sessionSchema.parse(JSON.parse(row.data));

    return row.pinned ? { ...session, pinned: true as const } : session;
  });

  const last = rows[SessionListLimits.PageSize - 1];

  return {
    sessions: page,
    nextCursor:
      hasMore && last ? encodeCursor({ deviceId, provider, id: last.id, recency: last.recency_at }) : null,
  };
}

export function hasListedSessionAfter(
  db: Sqlite.Database,
  deviceId: string,
  provider: ProviderFilterValue,
  session: Session,
) {
  const values: (string | number)[] = [deviceId];
  const providerClause = provider === ProviderFilterValue.All ? '' : ' AND provider=?';

  if (provider !== ProviderFilterValue.All) {
    values.push(provider.toLowerCase());
  }

  values.push(recencyOf(session), recencyOf(session), session.id);

  return (
    db
      .prepare(
        `SELECT id FROM listed_sessions WHERE device_id=?${providerClause} AND NOT EXISTS (SELECT 1 FROM session_hidden hidden WHERE hidden.device_id=listed_sessions.device_id AND hidden.id=listed_sessions.id AND listed_sessions.recency_at<=hidden.hidden_at) AND (recency_at<? OR (recency_at=? AND id>?)) ORDER BY recency_at DESC,id ASC LIMIT 1`,
      )
      .get(...values) !== undefined
  );
}
