import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn, type Database } from '../../db/database.js';
import { devices, users } from '../../db/schema/index.js';

export interface DeviceRecord {
  id: string;
  owner_id: string;
  generation: string;
  revoked_at: number | null;
  last_seen_at: number;
  snapshot: unknown;
  connectors: unknown;
}

const record = {
  id: devices.id,
  owner_id: devices.ownerId,
  generation: devices.generation,
  revoked_at: devices.revokedAt,
  last_seen_at: devices.lastSeenAt,
  snapshot: devices.snapshot,
  connectors: devices.connectors,
};

export class DeviceRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** An owned, unrevoked device. */
  async owned(ownerId: string, id: string): Promise<DeviceRecord | undefined> {
    const [row] = await this.db.orm
      .select(record)
      .from(devices)
      .where(and(eq(devices.ownerId, ownerId), eq(devices.id, id), isNull(devices.revokedAt)));

    return row;
  }

  /** The unrevoked device a token hash belongs to. */
  async byToken(tokenHash: string): Promise<DeviceRecord | undefined> {
    const [row] = await this.db.orm
      .select(record)
      .from(devices)
      .where(and(eq(devices.tokenHash, tokenHash), isNull(devices.revokedAt)));

    return row;
  }

  /** The owner's unrevoked devices; `last_seen_at` stays the decimal string clients already parse. */
  async list(ownerId: string) {
    return this.db.orm
      .select({ id: devices.id, last_seen_at: sql<string>`${devices.lastSeenAt}::text` })
      .from(devices)
      .where(and(eq(devices.ownerId, ownerId), isNull(devices.revokedAt)));
  }

  /** Serializes pairing for one owner. */
  async lockOwner(tx: PoolClient, ownerId: string) {
    await ormOn(tx).select({ id: users.id }).from(users).where(eq(users.id, ownerId)).for('update');
  }

  async hasActive(tx: PoolClient, ownerId: string): Promise<boolean> {
    const rows = await ormOn(tx)
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.ownerId, ownerId), isNull(devices.revokedAt)));

    return rows.length > 0;
  }

  async insert(tx: PoolClient, id: string, ownerId: string, tokenHash: string, generation: string) {
    await ormOn(tx).insert(devices).values({ id, ownerId, tokenHash, generation });
  }

  async revoke(ownerId: string, id: string, now: number) {
    await this.db.orm
      .update(devices)
      .set({ revokedAt: now, snapshot: null, connectors: sql`'[]'::jsonb` })
      .where(and(eq(devices.ownerId, ownerId), eq(devices.id, id)));
  }

  async touch(ownerId: string, id: string, lastSeen: number) {
    await this.db.orm
      .update(devices)
      .set({ lastSeenAt: lastSeen })
      .where(and(eq(devices.ownerId, ownerId), eq(devices.id, id)));
  }

  async saveSnapshot(tx: PoolClient, ownerId: string, id: string, snapshot: unknown, connectors: unknown) {
    await ormOn(tx)
      .update(devices)
      .set({
        snapshot: sql`${JSON.stringify(snapshot)}::jsonb`,
        connectors: sql`${JSON.stringify(connectors)}::jsonb`,
      })
      .where(and(eq(devices.ownerId, ownerId), eq(devices.id, id)));
  }
}
