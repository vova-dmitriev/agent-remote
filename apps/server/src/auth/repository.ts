import type { PoolClient } from 'pg';
import type { Database } from '../db/database.js';

/** Users and their short-lived access tokens, stored by token hash. */
export class AuthRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** Creates the user of a Telegram identity once; returns its id. */
  async upsertUser(tx: PoolClient, id: string, telegramId: string, now: number): Promise<string> {
    const row = await tx.query<{ id: string }>(
      'INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,$3) ON CONFLICT(telegram_id) DO UPDATE SET telegram_id=EXCLUDED.telegram_id RETURNING id',
      [id, telegramId, now],
    );

    return row.rows[0]!.id;
  }

  async insertToken(tx: PoolClient, tokenHash: string, ownerId: string, expiresAt: number) {
    await tx.query('INSERT INTO auth_sessions(token_hash,owner_id,expires_at) VALUES($1,$2,$3)', [
      tokenHash,
      ownerId,
      expiresAt,
    ]);
  }

  async deleteExpiredTokens(tx: PoolClient, now: number) {
    await tx.query('DELETE FROM auth_sessions WHERE expires_at<$1', [now]);
  }

  /** The user an unexpired token hash belongs to, and when the token expires. */
  async principal(tokenHash: string, now: number) {
    return (
      await this.db.pool.query<{ id: string; telegram_id: string; expires_at: string }>(
        'SELECT u.id,u.telegram_id,a.expires_at FROM auth_sessions a JOIN users u ON u.id=a.owner_id WHERE a.token_hash=$1 AND a.expires_at>$2',
        [tokenHash, now],
      )
    ).rows[0];
  }

  /** The expiry of each given token hash that is still stored and unexpired; revoked and expired ones are absent. */
  async unexpired(tokenHashes: readonly string[], now: number): Promise<Map<string, number>> {
    const rows = (
      await this.db.pool.query<{ token_hash: string; expires_at: string }>(
        'SELECT token_hash,expires_at FROM auth_sessions WHERE token_hash=ANY($1::text[]) AND expires_at>$2',
        [tokenHashes, now],
      )
    ).rows;

    return new Map(rows.map((row) => [row.token_hash, Number(row.expires_at)]));
  }

  async lockToken(tx: PoolClient, tokenHash: string) {
    await tx.query('SELECT token_hash FROM auth_sessions WHERE token_hash=$1 FOR UPDATE', [tokenHash]);
  }

  /** A token and every token issued from the same browser session. */
  async siblingTokens(tx: PoolClient, tokenHash: string): Promise<string[]> {
    return (
      await tx.query<{ token_hash: string }>(
        'SELECT token_hash FROM auth_sessions WHERE token_hash=$1 OR browser_session_hash=(SELECT browser_session_hash FROM auth_sessions WHERE token_hash=$1)',
        [tokenHash],
      )
    ).rows.map((row) => row.token_hash);
  }

  async deleteBrowserSessionOf(tx: PoolClient, tokenHash: string) {
    await tx.query(
      'DELETE FROM browser_sessions WHERE token_hash=(SELECT browser_session_hash FROM auth_sessions WHERE token_hash=$1)',
      [tokenHash],
    );
  }

  async deleteToken(tx: PoolClient, tokenHash: string) {
    await tx.query('DELETE FROM auth_sessions WHERE token_hash=$1', [tokenHash]);
  }
}
