import { EventType, MessageRole } from '@protocol';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn, type Database } from '../../db/database.js';
import {
  botState,
  devices,
  events,
  notificationOutbox,
  sessions,
  userPreferences,
  users,
} from '../../db/schema/index.js';

export interface OutboxRow {
  id: string;
  owner_id: string;
  private_chat_id: string;
  kind: string;
  session_id: string | null;
  attempts: number;
  next_attempt_at: number;
  created_at: number;
  /** The recipient's app language, when they chose one. */
  language: string | null;
}

export interface NotificationSessionRow {
  device_id: string;
  data: { title?: string; target?: { kind?: string }; errorCode?: string };
}

export interface NotificationEventData {
  type?: string;
  payload?: { role?: string; text?: string; reason?: string };
}

const OFFSET_KEY = 'offset';

/** Unsent, for a user with a private chat and notifications on. */
const deliverable = and(
  eq(notificationOutbox.sent, false),
  isNotNull(users.privateChatId),
  eq(users.notificationsEnabled, true),
)!;

/** The Telegram outbox, its recipients and the bot's update offset. */
export class NotificationRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  async record(id: string, ownerId: string, sessionId: string | null, kind: string, now: number) {
    await this.db.orm
      .insert(notificationOutbox)
      .values({ id, ownerId, sessionId, kind, createdAt: now, nextAttemptAt: now })
      .onConflictDoNothing();
  }

  async recordPairing(id: string, ownerId: string, kind: string, now: number) {
    await this.db.orm
      .insert(notificationOutbox)
      .values({ id, ownerId, kind, createdAt: now, nextAttemptAt: now })
      .onConflictDoNothing();
  }

  /** Locks the next unsent notification for an enabled private chat: the given one, or the oldest due one. */
  async lockNext(tx: PoolClient, now: number, outboxId: string | null): Promise<OutboxRow | undefined> {
    const [row] = await ormOn(tx)
      .select({
        id: notificationOutbox.id,
        owner_id: notificationOutbox.ownerId,
        private_chat_id: sql<string>`${users.privateChatId}`,
        kind: notificationOutbox.kind,
        session_id: notificationOutbox.sessionId,
        attempts: notificationOutbox.attempts,
        next_attempt_at: notificationOutbox.nextAttemptAt,
        created_at: notificationOutbox.createdAt,
        language: userPreferences.language,
      })
      .from(notificationOutbox)
      .innerJoin(users, eq(users.id, notificationOutbox.ownerId))
      .leftJoin(userPreferences, eq(userPreferences.ownerId, notificationOutbox.ownerId))
      .where(
        and(
          deliverable,
          outboxId === null
            ? lte(notificationOutbox.nextAttemptAt, now)
            : eq(notificationOutbox.id, outboxId),
        ),
      )
      .orderBy(asc(notificationOutbox.createdAt))
      .limit(1)
      .for('update', { of: notificationOutbox, skipLocked: true });

    return row;
  }

  async markSent(tx: PoolClient, id: string) {
    await ormOn(tx).update(notificationOutbox).set({ sent: true }).where(eq(notificationOutbox.id, id));
  }

  async disableOwner(tx: PoolClient, ownerId: string) {
    await ormOn(tx).update(users).set({ notificationsEnabled: false }).where(eq(users.id, ownerId));
  }

  async retryAt(tx: PoolClient, at: number, id: string) {
    await ormOn(tx)
      .update(notificationOutbox)
      .set({ attempts: sql`${notificationOutbox.attempts}+1`, nextAttemptAt: at })
      .where(eq(notificationOutbox.id, id));
  }

  /** The ids of up to 100 due notifications for enabled private chats, oldest first. */
  async due(now: number): Promise<string[]> {
    const rows = await this.db.orm
      .select({ id: notificationOutbox.id })
      .from(notificationOutbox)
      .innerJoin(users, eq(users.id, notificationOutbox.ownerId))
      .where(and(deliverable, lte(notificationOutbox.nextAttemptAt, now)))
      .orderBy(asc(notificationOutbox.createdAt))
      .limit(100);

    return rows.map((row) => row.id);
  }

  /** The owned session a notification refers to, on a live device. */
  async session(
    tx: PoolClient,
    ownerId: string,
    sessionId: string | null,
  ): Promise<NotificationSessionRow | undefined> {
    if (sessionId === null) {
      return undefined;
    }

    const [row] = await ormOn(tx)
      .select({ device_id: sessions.deviceId, data: sessions.data })
      .from(sessions)
      .innerJoin(devices, and(eq(devices.id, sessions.deviceId), eq(devices.ownerId, sessions.ownerId)))
      .where(and(eq(sessions.ownerId, ownerId), eq(sessions.id, sessionId), isNull(devices.revokedAt)));

    return row as NotificationSessionRow | undefined;
  }

  /** The latest turn end and chat message of a session, at or before a time, newest first. */
  async latestTurn(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    sessionId: string | null,
    createdAt: number,
  ): Promise<NotificationEventData[]> {
    if (sessionId === null) {
      return [];
    }

    const rows = await ormOn(tx)
      .select({ data: events.data })
      .from(events)
      .where(
        and(
          eq(events.ownerId, ownerId),
          eq(events.deviceId, deviceId),
          eq(events.sessionId, sessionId),
          lte(events.occurredAt, createdAt),
          or(
            sql`${events.data}->>'type'=${EventType.TurnEnd}`,
            and(
              sql`${events.data}->>'type'=${EventType.Message}`,
              inArray(sql`${events.data}->'payload'->>'role'`, [MessageRole.Assistant, MessageRole.User]),
            ),
          ),
        ),
      )
      .orderBy(desc(events.occurredAt), desc(events.seq))
      .limit(2);

    return rows.map((item) => item.data as NotificationEventData);
  }

  /** Registers a Telegram user's private chat and enables notifications; returns the user id. */
  async registerChat(id: string, telegramId: string, now: number): Promise<string> {
    const [row] = await this.db.orm
      .insert(users)
      .values({ id, telegramId, createdAt: now, privateChatId: telegramId, notificationsEnabled: true })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: { privateChatId: sql`excluded.private_chat_id`, notificationsEnabled: true },
      })
      .returning({ id: users.id });

    return row!.id;
  }

  async offset(): Promise<string | undefined> {
    const [row] = await this.db.orm
      .select({ value: botState.value })
      .from(botState)
      .where(eq(botState.key, OFFSET_KEY));

    return row?.value;
  }

  async saveOffset(value: string) {
    await this.db.orm
      .insert(botState)
      .values({ key: OFFSET_KEY, value })
      .onConflictDoUpdate({ target: botState.key, set: { value: sql`excluded.value` } });
  }
}
