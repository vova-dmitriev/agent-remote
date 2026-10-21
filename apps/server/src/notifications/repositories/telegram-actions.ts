import { EventType } from '@protocol';
import { and, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn, type Database } from '../../db/database.js';
import { events, sessions, telegramActions, userPreferences, users } from '../../db/schema/index.js';

export interface TelegramAction {
  token: string;
  ownerId: string;
  deviceId: string;
  sessionId: string;
  requestId: string;
  generation: string;
  expiresAt: number;
}

/** Telegram answer buttons: the request a token answers, usable once and only by its owner. */
export class TelegramActionRepository {
  constructor(private readonly db: Database) {}

  /** The latest permission event of a session at or before a notification, with the device it came from. */
  async latestPermission(tx: PoolClient, ownerId: string, sessionId: string, createdAt: number) {
    const [row] = await ormOn(tx)
      .select({ deviceId: events.deviceId, data: events.data })
      .from(events)
      .where(
        and(
          eq(events.ownerId, ownerId),
          eq(events.sessionId, sessionId),
          lte(events.occurredAt, createdAt),
          sql`${events.data}->>'type'=${EventType.Permission}`,
        ),
      )
      .orderBy(desc(events.occurredAt), desc(events.seq))
      .limit(1);

    return row as { deviceId: string; data: { payload?: Record<string, unknown> } } | undefined;
  }

  /** The language a Telegram user chose in the app, for the answer toast. */
  async language(telegramId: string) {
    const [row] = await this.db.orm
      .select({ language: userPreferences.language })
      .from(userPreferences)
      .innerJoin(users, eq(users.id, userPreferences.ownerId))
      .where(eq(users.telegramId, telegramId));

    return row?.language ?? null;
  }

  async save(tx: PoolClient, action: TelegramAction) {
    await ormOn(tx).insert(telegramActions).values(action).onConflictDoNothing();
  }

  /** Spends a token pressed by this Telegram user, if it is theirs and still open; with the session's target. */
  async take(telegramId: string, token: string, now: number) {
    const [action] = await this.db.orm
      .delete(telegramActions)
      .where(
        and(
          eq(telegramActions.token, token),
          gt(telegramActions.expiresAt, now),
          inArray(
            telegramActions.ownerId,
            this.db.orm.select({ id: users.id }).from(users).where(eq(users.telegramId, telegramId)),
          ),
        ),
      )
      .returning();

    if (!action) {
      return undefined;
    }

    const [session] = await this.db.orm
      .select({ data: sessions.data })
      .from(sessions)
      .where(
        and(
          eq(sessions.ownerId, action.ownerId),
          eq(sessions.deviceId, action.deviceId),
          eq(sessions.id, action.sessionId),
        ),
      );

    return session ? { ...action, target: (session.data as { target: unknown }).target } : undefined;
  }
}
