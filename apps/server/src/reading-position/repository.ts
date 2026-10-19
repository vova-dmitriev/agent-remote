import type { ReadingPosition } from '@protocol';
import type { Pool, PoolClient } from 'pg';
import type { Database } from '../db/database.js';

export type ReadingPositionRow = {
  message_id: string;
  pixel_offset: number;
  cursor: string | null;
  updated_at: string;
};

export class ReadingPositionRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** The device of an owned session on a live device; `tx` locks the device row against revocation. */
  async sessionDevice(ownerId: string, sessionId: string, tx?: PoolClient): Promise<string | undefined> {
    const executor: Pool | PoolClient = tx ?? this.db.pool;
    const lock = tx !== undefined;

    const result = await executor.query<{ device_id: string }>(
      `SELECT s.device_id FROM sessions s JOIN devices d ON d.owner_id=s.owner_id AND d.id=s.device_id
       WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL${lock ? ' FOR SHARE OF d' : ''}`,
      [ownerId, sessionId],
    );

    return result.rows[0]?.device_id;
  }

  async find(
    ownerId: string,
    deviceId: string,
    sessionId: string,
    tx?: PoolClient,
  ): Promise<ReadingPositionRow | undefined> {
    const executor: Pool | PoolClient = tx ?? this.db.pool;

    const result = await executor.query<ReadingPositionRow>(
      'SELECT message_id,pixel_offset,cursor,updated_at FROM reading_positions WHERE owner_id=$1 AND device_id=$2 AND session_id=$3',
      [ownerId, deviceId, sessionId],
    );

    return result.rows[0];
  }

  /** Stores a newer position; returns nothing when the stored one is at least as recent. */
  async saveNewer(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    sessionId: string,
    position: ReadingPosition,
  ): Promise<ReadingPositionRow | undefined> {
    const result = await tx.query<ReadingPositionRow>(
      `INSERT INTO reading_positions(owner_id,device_id,session_id,message_id,pixel_offset,cursor,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,device_id,session_id) DO UPDATE SET
         message_id=EXCLUDED.message_id,pixel_offset=EXCLUDED.pixel_offset,cursor=EXCLUDED.cursor,updated_at=EXCLUDED.updated_at
         WHERE EXCLUDED.updated_at>reading_positions.updated_at RETURNING message_id,pixel_offset,cursor,updated_at`,
      [
        ownerId,
        deviceId,
        sessionId,
        position.messageId,
        position.offset,
        position.cursor ?? null,
        position.updatedAt,
      ],
    );

    return result.rows[0];
  }
}
