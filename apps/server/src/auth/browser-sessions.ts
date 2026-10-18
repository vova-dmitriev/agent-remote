import { ErrorCode } from '../../../../packages/protocol/src/index.js';
import { type Database } from '../db/database.js';
import { Fault, hash, secret } from './security.js';

export class BrowserSessions {
  constructor(private db: Database) {}
  async create(access: string, now = Date.now()) {
    const credential = secret(),
      expiresAt = now + 30 * 24 * 60 * 60 * 1000;

    await this.db.transaction(async (tx) => {
      const row = (
        await tx.query<{ owner_id: string }>(
          'SELECT owner_id FROM auth_sessions WHERE token_hash=$1 AND expires_at>$2 FOR UPDATE',
          [hash(access), now],
        )
      ).rows[0];

      if (!row) {
        throw new Fault(ErrorCode.UNAUTHORIZED, 401);
      }

      await tx.query('INSERT INTO browser_sessions(token_hash,owner_id,expires_at) VALUES($1,$2,$3)', [
        hash(credential),
        row.owner_id,
        expiresAt,
      ]);

      await tx.query('UPDATE auth_sessions SET browser_session_hash=$1 WHERE token_hash=$2', [
        hash(credential),
        hash(access),
      ]);

      await tx.query('DELETE FROM browser_sessions WHERE expires_at<=$1', [now]);
    });

    return { secret: credential, expiresAt };
  }
  async revoke(credential: string) {
    if (!/^[a-f0-9]{64}$/.test(credential)) {
      throw new Fault(ErrorCode.UNAUTHORIZED, 401);
    }

    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query('SELECT token_hash FROM browser_sessions WHERE token_hash=$1 FOR UPDATE', [
          hash(credential),
        ])
      ).rowCount;

      if (!row) {
        throw new Fault(ErrorCode.UNAUTHORIZED, 401);
      }

      const revoked = (
        await tx.query<{ token_hash: string }>(
          'SELECT token_hash FROM auth_sessions WHERE browser_session_hash=$1',
          [hash(credential)],
        )
      ).rows.map((row) => row.token_hash);

      await tx.query('DELETE FROM browser_sessions WHERE token_hash=$1', [hash(credential)]);

      return revoked;
    });
  }
  async refresh(credential: string, now = Date.now(), expectedTelegramId?: string) {
    if (!/^[a-f0-9]{64}$/.test(credential)) {
      throw new Fault(ErrorCode.UNAUTHORIZED, 401);
    }

    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query<{ owner_id: string; expires_at: string; telegram_id: string }>(
          'SELECT b.owner_id,b.expires_at,u.telegram_id FROM browser_sessions b JOIN users u ON u.id=b.owner_id WHERE b.token_hash=$1 AND b.expires_at>$2 FOR UPDATE OF b',
          [hash(credential), now],
        )
      ).rows[0];

      if (!row || (expectedTelegramId !== undefined && row.telegram_id !== expectedTelegramId)) {
        throw new Fault(ErrorCode.UNAUTHORIZED, 401);
      }

      const token = secret(),
        expiresAt = Math.min(now + 900000, Number(row.expires_at));

      await tx.query(
        'INSERT INTO auth_sessions(token_hash,owner_id,expires_at,browser_session_hash) VALUES($1,$2,$3,$4)',
        [hash(token), row.owner_id, expiresAt, hash(credential)],
      );

      await tx.query('DELETE FROM auth_sessions WHERE expires_at<=$1', [now]);

      return { token, expiresAt };
    });
  }
}
export const refreshCookieName = 'agent_remote_refresh';

export function refreshCookie(value: string, secure: boolean, maxAge: number) {
  return `${refreshCookieName}=${value}; HttpOnly; SameSite=Strict; Path=/auth; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function readRefreshCookie(value: string | undefined) {
  const matches = (value ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(refreshCookieName + '='));

  return matches.length === 1 ? matches[0]!.slice(refreshCookieName.length + 1) : '';
}
