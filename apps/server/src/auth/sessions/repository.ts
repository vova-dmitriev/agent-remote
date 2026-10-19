import type { PoolClient } from 'pg';
import type { Database } from '../../db/database.js';

/** Long-lived browser sessions and the access tokens they issue, stored by hash. */
export class BrowserSessionRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** Locks an unexpired access token; returns its owner. */
  async lockAccess(tx: PoolClient, accessHash: string, now: number): Promise<string | undefined> {
    return (
      await tx.query<{ owner_id: string }>(
        'SELECT owner_id FROM auth_sessions WHERE token_hash=$1 AND expires_at>$2 FOR UPDATE',
        [accessHash, now],
      )
    ).rows[0]?.owner_id;
  }

  async insert(tx: PoolClient, credentialHash: string, ownerId: string, expiresAt: number) {
    await tx.query('INSERT INTO browser_sessions(token_hash,owner_id,expires_at) VALUES($1,$2,$3)', [
      credentialHash,
      ownerId,
      expiresAt,
    ]);
  }

  async linkAccess(tx: PoolClient, credentialHash: string, accessHash: string) {
    await tx.query('UPDATE auth_sessions SET browser_session_hash=$1 WHERE token_hash=$2', [
      credentialHash,
      accessHash,
    ]);
  }

  async deleteExpired(tx: PoolClient, now: number) {
    await tx.query('DELETE FROM browser_sessions WHERE expires_at<=$1', [now]);
  }

  /** Locks a browser session; returns whether it exists. */
  async lock(tx: PoolClient, credentialHash: string): Promise<boolean> {
    return Boolean(
      (
        await tx.query('SELECT token_hash FROM browser_sessions WHERE token_hash=$1 FOR UPDATE', [
          credentialHash,
        ])
      ).rowCount,
    );
  }

  async accessTokens(tx: PoolClient, credentialHash: string): Promise<string[]> {
    return (
      await tx.query<{ token_hash: string }>(
        'SELECT token_hash FROM auth_sessions WHERE browser_session_hash=$1',
        [credentialHash],
      )
    ).rows.map((row) => row.token_hash);
  }

  async delete(tx: PoolClient, credentialHash: string) {
    await tx.query('DELETE FROM browser_sessions WHERE token_hash=$1', [credentialHash]);
  }

  /** Locks an unexpired browser session with its owner's Telegram identity. */
  async lockForRefresh(tx: PoolClient, credentialHash: string, now: number) {
    return (
      await tx.query<{ owner_id: string; expires_at: string; telegram_id: string }>(
        'SELECT b.owner_id,b.expires_at,u.telegram_id FROM browser_sessions b JOIN users u ON u.id=b.owner_id WHERE b.token_hash=$1 AND b.expires_at>$2 FOR UPDATE OF b',
        [credentialHash, now],
      )
    ).rows[0];
  }

  async insertAccess(
    tx: PoolClient,
    tokenHash: string,
    ownerId: string,
    expiresAt: number,
    credentialHash: string,
  ) {
    await tx.query(
      'INSERT INTO auth_sessions(token_hash,owner_id,expires_at,browser_session_hash) VALUES($1,$2,$3,$4)',
      [tokenHash, ownerId, expiresAt, credentialHash],
    );
  }

  async deleteExpiredAccess(tx: PoolClient, now: number) {
    await tx.query('DELETE FROM auth_sessions WHERE expires_at<=$1', [now]);
  }
}
