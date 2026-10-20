import type { Session } from '@protocol';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn, type Database } from '../db/database.js';
import { devices, sessionActivity, sessionLabels, sessions } from '../db/schema/index.js';

const ownedSession = (ownerId: string, deviceId: string, sessionId: string) =>
  and(eq(sessions.ownerId, ownerId), eq(sessions.deviceId, deviceId), eq(sessions.id, sessionId))!;

export class SessionRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  async deviceOf(ownerId: string, sessionId: string): Promise<string | undefined> {
    const [row] = await this.db.orm
      .select({ deviceId: sessions.deviceId })
      .from(sessions)
      .where(and(eq(sessions.ownerId, ownerId), eq(sessions.id, sessionId)));

    return row?.deviceId;
  }

  async exists(ownerId: string, deviceId: string, sessionId: string): Promise<boolean> {
    const rows = await this.db.orm
      .select({ id: sessions.id })
      .from(sessions)
      .where(ownedSession(ownerId, deviceId, sessionId));

    return rows.length > 0;
  }

  async labels(ownerId: string, deviceId: string) {
    return this.db.orm
      .select({ source_key: sessionLabels.sourceKey, title: sessionLabels.title })
      .from(sessionLabels)
      .where(and(eq(sessionLabels.ownerId, ownerId), eq(sessionLabels.deviceId, deviceId)));
  }

  async activity(ownerId: string, deviceId: string) {
    return this.db.orm
      .select({ session_id: sessionActivity.sessionId, last_message_at: sessionActivity.lastMessageAt })
      .from(sessionActivity)
      .where(and(eq(sessionActivity.ownerId, ownerId), eq(sessionActivity.deviceId, deviceId)));
  }

  /** Locks an owned session on a live device. */
  /** An owned session on a device that is not revoked: its device and generation. */
  async live(ownerId: string, sessionId: string) {
    const [row] = await this.db.orm
      .select({ deviceId: sessions.deviceId, generation: sql<string>`${sessions.data}->>'generation'` })
      .from(sessions)
      .innerJoin(devices, and(eq(devices.ownerId, sessions.ownerId), eq(devices.id, sessions.deviceId)))
      .where(and(eq(sessions.ownerId, ownerId), eq(sessions.id, sessionId), isNull(devices.revokedAt)));

    return row;
  }

  async lockLive(tx: PoolClient, ownerId: string, sessionId: string) {
    const [row] = await ormOn(tx)
      .select({ data: sessions.data, device_id: sessions.deviceId })
      .from(sessions)
      .innerJoin(devices, and(eq(devices.ownerId, sessions.ownerId), eq(devices.id, sessions.deviceId)))
      .where(and(eq(sessions.ownerId, ownerId), eq(sessions.id, sessionId), isNull(devices.revokedAt)))
      .for('update', { of: sessions });

    return row as { data: Session; device_id: string } | undefined;
  }

  async saveLabel(tx: PoolClient, ownerId: string, deviceId: string, sourceKey: string, title: string) {
    await ormOn(tx)
      .insert(sessionLabels)
      .values({ ownerId, deviceId, sourceKey, title })
      .onConflictDoUpdate({
        target: [sessionLabels.ownerId, sessionLabels.deviceId, sessionLabels.sourceKey],
        set: { title: sql`excluded.title` },
      });
  }

  async setTitle(tx: PoolClient, ownerId: string, deviceId: string, sessionId: string, title: string) {
    await ormOn(tx)
      .update(sessions)
      .set({ data: sql`jsonb_set(${sessions.data}, '{title}', to_jsonb(${title}::text))` })
      .where(ownedSession(ownerId, deviceId, sessionId));
  }

  /** Replaces a device's stored sessions with its snapshot's. */
  async replaceAll(tx: PoolClient, ownerId: string, deviceId: string, snapshot: readonly Session[]) {
    const orm = ormOn(tx);

    await orm.delete(sessions).where(and(eq(sessions.ownerId, ownerId), eq(sessions.deviceId, deviceId)));

    if (snapshot.length) {
      await orm.insert(sessions).values(
        snapshot.map((session) => ({
          ownerId,
          deviceId,
          id: session.id,
          data: sql`${JSON.stringify(session)}::jsonb`,
        })),
      );
    }
  }
}
