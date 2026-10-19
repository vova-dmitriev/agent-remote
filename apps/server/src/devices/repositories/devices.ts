import type { PoolClient } from 'pg';
import type { Database } from '../../db/database.js';

export interface DeviceRecord {
  id: string;
  owner_id: string;
  generation: string;
  revoked_at: string | null;
  last_seen_at: string;
  snapshot: unknown;
  connectors: unknown;
}

export class DeviceRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** An owned, unrevoked device. */
  async owned(ownerId: string, id: string): Promise<DeviceRecord | undefined> {
    return (
      await this.db.pool.query<DeviceRecord>(
        'SELECT id,owner_id,generation,revoked_at,last_seen_at,snapshot,connectors FROM devices WHERE owner_id=$1 AND id=$2 AND revoked_at IS NULL',
        [ownerId, id],
      )
    ).rows[0];
  }

  /** The unrevoked device a token hash belongs to. */
  async byToken(tokenHash: string): Promise<DeviceRecord | undefined> {
    return (
      await this.db.pool.query<DeviceRecord>(
        'SELECT id,owner_id,generation,revoked_at,last_seen_at,snapshot,connectors FROM devices WHERE token_hash=$1 AND revoked_at IS NULL',
        [tokenHash],
      )
    ).rows[0];
  }

  async list(ownerId: string) {
    return (
      await this.db.pool.query(
        'SELECT id,last_seen_at FROM devices WHERE owner_id=$1 AND revoked_at IS NULL',
        [ownerId],
      )
    ).rows;
  }

  /** Serializes pairing for one owner. */
  async lockOwner(tx: PoolClient, ownerId: string) {
    await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
  }

  async hasActive(tx: PoolClient, ownerId: string): Promise<boolean> {
    return Boolean(
      (await tx.query('SELECT id FROM devices WHERE owner_id=$1 AND revoked_at IS NULL', [ownerId])).rowCount,
    );
  }

  async insert(tx: PoolClient, id: string, ownerId: string, tokenHash: string, generation: string) {
    await tx.query('INSERT INTO devices(id,owner_id,token_hash,generation) VALUES($1,$2,$3,$4)', [
      id,
      ownerId,
      tokenHash,
      generation,
    ]);
  }

  async revoke(ownerId: string, id: string, now: number) {
    await this.db.pool.query(
      "UPDATE devices SET revoked_at=$1,snapshot=NULL,connectors='[]' WHERE owner_id=$2 AND id=$3",
      [now, ownerId, id],
    );
  }

  async touch(ownerId: string, id: string, lastSeen: number) {
    await this.db.pool.query('UPDATE devices SET last_seen_at=$1 WHERE owner_id=$2 AND id=$3', [
      lastSeen,
      ownerId,
      id,
    ]);
  }

  async saveSnapshot(tx: PoolClient, ownerId: string, id: string, snapshot: unknown, connectors: unknown) {
    await tx.query('UPDATE devices SET snapshot=$1,connectors=$2 WHERE owner_id=$3 AND id=$4', [
      JSON.stringify(snapshot),
      JSON.stringify(connectors),
      ownerId,
      id,
    ]);
  }
}
