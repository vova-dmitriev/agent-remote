import type { ReadingPosition } from '@protocol';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn, type Database } from '../db/database.js';
import { devices, readingPositions, sessions } from '../db/schema/index.js';

export type ReadingPositionRow = {
  message_id: string;
  pixel_offset: number;
  cursor: string | null;
  updated_at: number;
};

const row = {
  message_id: readingPositions.messageId,
  pixel_offset: readingPositions.pixelOffset,
  cursor: readingPositions.cursor,
  updated_at: readingPositions.updatedAt,
};

export class ReadingPositionRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /**
   * The device of an owned session on a live device. `lock` holds the device row against revocation until `tx`
   * ends, so it needs a transaction.
   */
  async sessionDevice(
    ownerId: string,
    sessionId: string,
    { tx, lock = false }: { tx?: PoolClient; lock?: boolean } = {},
  ): Promise<string | undefined> {
    const query = (tx ? ormOn(tx) : this.db.orm)
      .select({ deviceId: sessions.deviceId })
      .from(sessions)
      .innerJoin(devices, and(eq(devices.ownerId, sessions.ownerId), eq(devices.id, sessions.deviceId)))
      .where(and(eq(sessions.ownerId, ownerId), eq(sessions.id, sessionId), isNull(devices.revokedAt)));

    const [found] = lock ? await query.for('share', { of: devices }) : await query;

    return found?.deviceId;
  }

  async find(
    ownerId: string,
    deviceId: string,
    sessionId: string,
    tx?: PoolClient,
  ): Promise<ReadingPositionRow | undefined> {
    const [found] = await (tx ? ormOn(tx) : this.db.orm)
      .select(row)
      .from(readingPositions)
      .where(
        and(
          eq(readingPositions.ownerId, ownerId),
          eq(readingPositions.deviceId, deviceId),
          eq(readingPositions.sessionId, sessionId),
        ),
      );

    return found;
  }

  /** Stores a newer position; returns nothing when the stored one is at least as recent. */
  async saveNewer(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    sessionId: string,
    position: ReadingPosition,
  ): Promise<ReadingPositionRow | undefined> {
    const [saved] = await ormOn(tx)
      .insert(readingPositions)
      .values({
        ownerId,
        deviceId,
        sessionId,
        messageId: position.messageId,
        pixelOffset: position.offset,
        cursor: position.cursor ?? null,
        updatedAt: position.updatedAt,
      })
      .onConflictDoUpdate({
        target: [readingPositions.ownerId, readingPositions.deviceId, readingPositions.sessionId],
        set: {
          messageId: sql`excluded.message_id`,
          pixelOffset: sql`excluded.pixel_offset`,
          cursor: sql`excluded.cursor`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: sql`excluded.updated_at > ${readingPositions.updatedAt}`,
      })
      .returning(row);

    return saved;
  }
}
