import { ErrorCode } from '@protocol';
import { randomInt, randomUUID } from 'node:crypto';
import { hash, secret, telegramIdentity, type Principal } from './security.js';
import { Fault } from '../http/errors/fault.js';
import { type AuthRepository } from './repository.js';

/** Client link codes: unambiguous letters and digits (no 0/O, 1/I), 8 of them (40 bits), valid for 5 minutes. */
const CLIENT_LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLIENT_LINK_LENGTH = 8;
const CLIENT_LINK_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 900000;

export class AuthService {
  constructor(
    private repository: AuthRepository,
    private botToken: string,
  ) {}
  async login(raw: string, now = Date.now()) {
    const { repository } = this;
    const telegramId = telegramIdentity(raw, this.botToken, now);
    const token = secret();
    const expiresAt = now + ACCESS_TOKEN_TTL_MS;

    await repository.transaction(async (tx) => {
      const ownerId = await repository.upsertUser(tx, randomUUID(), telegramId, now);

      await repository.insertToken(tx, hash(token), ownerId, expiresAt);
      await repository.deleteExpiredTokens(tx, now);
    });

    return { token, expiresAt };
  }
  /** A short code that links another client (the Chrome extension) to this owner, once, for five minutes. */
  async linkCode(ownerId: string, now = Date.now()) {
    const code = Array.from(
      { length: CLIENT_LINK_LENGTH },
      () => CLIENT_LINK_ALPHABET[randomInt(CLIENT_LINK_ALPHABET.length)],
    ).join('');

    const expiresAt = now + CLIENT_LINK_TTL_MS;

    await this.repository.insertLink(hash(code), ownerId, expiresAt, now);

    return { code, expiresAt };
  }
  /** Redeems a link code once for a fresh access token of its owner; an unknown, used or expired code is refused. */
  async redeemLink(raw: string, now = Date.now()) {
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/gu, '');

    const ownerId =
      code.length === CLIENT_LINK_LENGTH ? await this.repository.takeLink(hash(code), now) : undefined;

    if (!ownerId) {
      throw new Fault(ErrorCode.UNAUTHORIZED);
    }

    const token = secret();
    const expiresAt = now + ACCESS_TOKEN_TTL_MS;

    await this.repository.transaction((tx) =>
      this.repository.insertToken(tx, hash(token), ownerId, expiresAt),
    );

    return { token, expiresAt };
  }
  async authenticate(token: string, now = Date.now()): Promise<Principal & { expiresAt: number }> {
    const row = await this.repository.principal(hash(token), now);

    if (!row) {
      throw new Fault(ErrorCode.UNAUTHORIZED);
    }

    return { userId: row.id, telegramId: row.telegram_id, expiresAt: Number(row.expires_at) };
  }
  /** One query for many tokens: the stored expiry of each token that is neither revoked nor expired. */
  async unexpired(tokens: readonly string[], now = Date.now()): Promise<Map<string, number>> {
    const hashes = new Map(tokens.map((token) => [hash(token), token]));
    const stored = await this.repository.unexpired([...hashes.keys()], now);

    return new Map([...stored].map(([tokenHash, expiresAt]) => [hashes.get(tokenHash)!, expiresAt]));
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
