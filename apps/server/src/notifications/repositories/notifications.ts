import { EventType, MessageRole } from '@protocol';
import type { PoolClient } from 'pg';
import type { Database } from '../../db/database.js';

export interface OutboxRow {
  id: string;
  owner_id: string;
  private_chat_id: string;
  kind: string;
  session_id: string | null;
  attempts: number;
  next_attempt_at: string;
  created_at: string;
}

export interface NotificationSessionRow {
  device_id: string;
  data: { title?: string; target?: { kind?: string }; errorCode?: string };
}

export interface NotificationEventData {
  type?: string;
  payload?: { role?: string; text?: string; reason?: string };
}

/** The Telegram outbox, its recipients and the bot's update offset. */
export class NotificationRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  async record(id: string, ownerId: string, sessionId: string | null, kind: string, now: number) {
    await this.db.pool.query(
      'INSERT INTO notification_outbox(id,owner_id,session_id,kind,created_at,next_attempt_at) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT DO NOTHING',
      [id, ownerId, sessionId, kind, now],
    );
  }

  async recordPairing(id: string, ownerId: string, kind: string, now: number) {
    await this.db.pool.query(
      'INSERT INTO notification_outbox(id,owner_id,kind,created_at,next_attempt_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING',
      [id, ownerId, kind, now],
    );
  }

  /** Locks the next unsent notification for an enabled private chat: the given one, or the oldest due one. */
  async lockNext(tx: PoolClient, now: number, outboxId: string | null): Promise<OutboxRow | undefined> {
    return (
      await tx.query<OutboxRow>(
        'SELECT o.*,u.private_chat_id FROM notification_outbox o JOIN users u ON u.id=o.owner_id WHERE o.sent=false AND ($2::text IS NULL OR o.id=$2) AND ($2::text IS NOT NULL OR o.next_attempt_at<=$1) AND u.private_chat_id IS NOT NULL AND u.notifications_enabled=true ORDER BY o.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED',
        [now, outboxId],
      )
    ).rows[0];
  }

  async markSent(tx: PoolClient, id: string) {
    await tx.query('UPDATE notification_outbox SET sent=true WHERE id=$1', [id]);
  }

  async disableOwner(tx: PoolClient, ownerId: string) {
    await tx.query('UPDATE users SET notifications_enabled=false WHERE id=$1', [ownerId]);
  }

  async retryAt(tx: PoolClient, at: number, id: string) {
    await tx.query('UPDATE notification_outbox SET attempts=attempts+1,next_attempt_at=$1 WHERE id=$2', [
      at,
      id,
    ]);
  }

  /** The ids of up to 100 due notifications for enabled private chats, oldest first. */
  async due(now: number): Promise<string[]> {
    return (
      await this.db.pool.query<{ id: string }>(
        'SELECT o.id FROM notification_outbox o JOIN users u ON u.id=o.owner_id WHERE o.sent=false AND o.next_attempt_at<=$1 AND u.private_chat_id IS NOT NULL AND u.notifications_enabled=true ORDER BY o.created_at LIMIT 100',
        [now],
      )
    ).rows.map((row) => row.id);
  }

  /** The owned session a notification refers to, on a live device. */
  async session(
    tx: PoolClient,
    ownerId: string,
    sessionId: string | null,
  ): Promise<NotificationSessionRow | undefined> {
    return (
      await tx.query<NotificationSessionRow>(
        'SELECT s.device_id,s.data FROM sessions s JOIN devices d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL',
        [ownerId, sessionId],
      )
    ).rows[0];
  }

  /** The latest turn end and chat message of a session, at or before a time, newest first. */
  async latestTurn(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    sessionId: string | null,
    createdAt: string,
  ): Promise<NotificationEventData[]> {
    return (
      await tx.query<{ data: NotificationEventData }>(
        "SELECT data FROM events WHERE owner_id=$1 AND device_id=$2 AND session_id=$3 AND occurred_at<=$4 AND (data->>'type'=$5 OR (data->>'type'=$6 AND data->'payload'->>'role' IN ($7,$8))) ORDER BY occurred_at DESC,seq DESC LIMIT 2",
        [
          ownerId,
          deviceId,
          sessionId,
          createdAt,
          EventType.TurnEnd,
          EventType.Message,
          MessageRole.Assistant,
          MessageRole.User,
        ],
      )
    ).rows.map((item) => item.data);
  }

  /** Registers a Telegram user's private chat and enables notifications; returns the user id. */
  async registerChat(id: string, telegramId: string, now: number): Promise<string> {
    return (
      await this.db.pool.query<{ id: string }>(
        'INSERT INTO users(id,telegram_id,created_at,private_chat_id,notifications_enabled) VALUES($1,$2,$3,$2,true) ON CONFLICT(telegram_id) DO UPDATE SET private_chat_id=EXCLUDED.private_chat_id,notifications_enabled=true RETURNING id',
        [id, telegramId, now],
      )
    ).rows[0]!.id;
  }

  async offset(): Promise<string | undefined> {
    return (await this.db.pool.query<{ value: string }>("SELECT value FROM bot_state WHERE key='offset'"))
      .rows[0]?.value;
  }

  async saveOffset(value: string) {
    await this.db.pool.query(
      "INSERT INTO bot_state(key,value) VALUES('offset',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
      [value],
    );
  }
}
