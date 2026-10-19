import { ErrorCode } from '@protocol';
import { type BrowserSessionRepository } from './repository.js';
import { hash, secret } from '../security.js';
import { Fault } from '../../http/errors/fault.js';

export class BrowserSessions {
  constructor(private repository: BrowserSessionRepository) {}
  async create(access: string, now = Date.now()) {
    const { repository } = this;

    const credential = secret(),
      expiresAt = now + 30 * 24 * 60 * 60 * 1000;

    await repository.transaction(async (tx) => {
      const ownerId = await repository.lockAccess(tx, hash(access), now);

      if (!ownerId) {
        throw new Fault(ErrorCode.UNAUTHORIZED);
      }

      await repository.insert(tx, hash(credential), ownerId, expiresAt);
      await repository.linkAccess(tx, hash(credential), hash(access));
      await repository.deleteExpired(tx, now);
    });

    return { secret: credential, expiresAt };
  }
  async revoke(credential: string) {
    if (!/^[a-f0-9]{64}$/.test(credential)) {
      throw new Fault(ErrorCode.UNAUTHORIZED);
    }

    const { repository } = this;

    return repository.transaction(async (tx) => {
      if (!(await repository.lock(tx, hash(credential)))) {
        throw new Fault(ErrorCode.UNAUTHORIZED);
      }

      const revoked = await repository.accessTokens(tx, hash(credential));

      await repository.delete(tx, hash(credential));

      return revoked;
    });
  }
  async refresh(credential: string, now = Date.now(), expectedTelegramId?: string) {
    if (!/^[a-f0-9]{64}$/.test(credential)) {
      throw new Fault(ErrorCode.UNAUTHORIZED);
    }

    const { repository } = this;

    return repository.transaction(async (tx) => {
      const row = await repository.lockForRefresh(tx, hash(credential), now);

      if (!row || (expectedTelegramId !== undefined && row.telegram_id !== expectedTelegramId)) {
        throw new Fault(ErrorCode.UNAUTHORIZED);
      }

      const token = secret(),
        expiresAt = Math.min(now + 900000, Number(row.expires_at));

      await repository.insertAccess(tx, hash(token), row.owner_id, expiresAt, hash(credential));
      await repository.deleteExpiredAccess(tx, now);

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
