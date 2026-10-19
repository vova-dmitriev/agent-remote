import { ErrorCode } from '@protocol';
import { randomUUID } from 'node:crypto';
import { type Database } from '../db/database.js';
import { Fault, hash, secret, telegramIdentity, type Principal } from './security.js';

export class AuthService {
  constructor(
    private db: Database,
    private botToken: string,
  ) {}
  async login(raw: string, now = Date.now()) {
    const telegramId = telegramIdentity(raw, this.botToken, now);
    const token = secret();
    const expiresAt = now + 900000;

    await this.db.transaction(async (tx) => {
      const row = await tx.query<{ id: string }>(
        'INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,$3) ON CONFLICT(telegram_id) DO UPDATE SET telegram_id=EXCLUDED.telegram_id RETURNING id',
        [randomUUID(), telegramId, now],
      );

      await tx.query('INSERT INTO auth_sessions(token_hash,owner_id,expires_at) VALUES($1,$2,$3)', [
        hash(token),
        row.rows[0]!.id,
        expiresAt,
      ]);

      await tx.query('DELETE FROM auth_sessions WHERE expires_at<$1', [now]);
    });

    return { token, expiresAt };
  }
  async authenticate(token: string, now = Date.now()): Promise<Principal> {
    const rows = await this.db.pool.query<{ id: string; telegram_id: string }>(
      'SELECT u.id,u.telegram_id FROM auth_sessions a JOIN users u ON u.id=a.owner_id WHERE a.token_hash=$1 AND a.expires_at>$2',
      [hash(token), now],
    );

    const row = rows.rows[0];

    if (!row) {
      throw new Fault(ErrorCode.UNAUTHORIZED, 401);
    }

    return { userId: row.id, telegramId: row.telegram_id };
  }
  async logout(token: string) {
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT token_hash FROM auth_sessions WHERE token_hash=$1 FOR UPDATE', [hash(token)]);

      const revoked = (
        await tx.query<{ token_hash: string }>(
          'SELECT token_hash FROM auth_sessions WHERE token_hash=$1 OR browser_session_hash=(SELECT browser_session_hash FROM auth_sessions WHERE token_hash=$1)',
          [hash(token)],
        )
      ).rows.map((row) => row.token_hash);

      await tx.query(
        'DELETE FROM browser_sessions WHERE token_hash=(SELECT browser_session_hash FROM auth_sessions WHERE token_hash=$1)',
        [hash(token)],
      );

      await tx.query('DELETE FROM auth_sessions WHERE token_hash=$1', [hash(token)]);

      return revoked;
    });
  }
}
