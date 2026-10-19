import { ErrorCode } from '@protocol';
import { randomUUID } from 'node:crypto';
import { hash, secret, telegramIdentity, type Principal } from './security.js';
import { Fault } from '../http/errors/fault.js';
import { type AuthRepository } from './repository.js';

export class AuthService {
  constructor(
    private repository: AuthRepository,
    private botToken: string,
  ) {}
  async login(raw: string, now = Date.now()) {
    const { repository } = this;
    const telegramId = telegramIdentity(raw, this.botToken, now);
    const token = secret();
    const expiresAt = now + 900000;

    await repository.transaction(async (tx) => {
      const ownerId = await repository.upsertUser(tx, randomUUID(), telegramId, now);

      await repository.insertToken(tx, hash(token), ownerId, expiresAt);
      await repository.deleteExpiredTokens(tx, now);
    });

    return { token, expiresAt };
  }
  async authenticate(token: string, now = Date.now()): Promise<Principal> {
    const row = await this.repository.principal(hash(token), now);

    if (!row) {
      throw new Fault(ErrorCode.UNAUTHORIZED);
    }

    return { userId: row.id, telegramId: row.telegram_id };
  }
  async logout(token: string) {
    const { repository } = this;
    const tokenHash = hash(token);

    return repository.transaction(async (tx) => {
      await repository.lockToken(tx, tokenHash);

      const revoked = await repository.siblingTokens(tx, tokenHash);

      await repository.deleteBrowserSessionOf(tx, tokenHash);
      await repository.deleteToken(tx, tokenHash);

      return revoked;
    });
  }
}
