import type { Session } from '@protocol';
import type { PoolClient } from 'pg';
import type { Database } from '../db/database.js';

export class SessionRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  async deviceOf(ownerId: string, sessionId: string): Promise<string | undefined> {
    return (
      await this.db.pool.query<{ device_id: string }>(
        'SELECT device_id FROM sessions WHERE owner_id=$1 AND id=$2',
        [ownerId, sessionId],
      )
    ).rows[0]?.device_id;
  }

  async exists(ownerId: string, deviceId: string, sessionId: string): Promise<boolean> {
    return Boolean(
      (
        await this.db.pool.query('SELECT id FROM sessions WHERE owner_id=$1 AND device_id=$2 AND id=$3', [
          ownerId,
          deviceId,
          sessionId,
        ])
      ).rowCount,
    );
  }

  async labels(ownerId: string, deviceId: string) {
    return (
      await this.db.pool.query<{ source_key: string; title: string }>(
        'SELECT source_key,title FROM session_labels WHERE owner_id=$1 AND device_id=$2',
        [ownerId, deviceId],
      )
    ).rows;
  }

  async activity(ownerId: string, deviceId: string) {
    return (
      await this.db.pool.query<{ session_id: string; last_message_at: string }>(
        'SELECT session_id,last_message_at FROM session_activity WHERE owner_id=$1 AND device_id=$2',
        [ownerId, deviceId],
      )
    ).rows;
  }

  /** Locks an owned session on a live device. */
  async lockLive(tx: PoolClient, ownerId: string, sessionId: string) {
    return (
      await tx.query<{ data: Session; device_id: string }>(
        'SELECT s.data,s.device_id FROM sessions s JOIN devices d ON d.owner_id=s.owner_id AND d.id=s.device_id WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL FOR UPDATE OF s',
        [ownerId, sessionId],
      )
    ).rows[0];
  }

  async saveLabel(tx: PoolClient, ownerId: string, deviceId: string, sourceKey: string, title: string) {
    await tx.query(
      'INSERT INTO session_labels(owner_id,device_id,source_key,title) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,device_id,source_key) DO UPDATE SET title=EXCLUDED.title',
      [ownerId, deviceId, sourceKey, title],
    );
  }

  async setTitle(tx: PoolClient, ownerId: string, deviceId: string, sessionId: string, title: string) {
    await tx.query(
      "UPDATE sessions SET data=jsonb_set(data,'{title}',to_jsonb($4::text)) WHERE owner_id=$1 AND device_id=$2 AND id=$3",
      [ownerId, deviceId, sessionId, title],
    );
  }

  /** Replaces a device's stored sessions with its snapshot's. */
  async replaceAll(tx: PoolClient, ownerId: string, deviceId: string, sessions: readonly Session[]) {
    await tx.query('DELETE FROM sessions WHERE owner_id=$1 AND device_id=$2', [ownerId, deviceId]);

    for (const session of sessions) {
      await tx.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
        ownerId,
        deviceId,
        session.id,
        JSON.stringify(session),
      ]);
    }
  }
}
