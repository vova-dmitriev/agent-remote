import { and, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn, type Database } from '../db/database.js';
import { authSessions, browserSessions, clientLinks, users } from '../db/schema/index.js';
import { AUTH_RECHECK_CHUNK } from '../maintenance/limits.js';

/** The browser session a token was issued from, as a scalar subquery. */
const browserSessionOf = (tokenHash: string) =>
  sql`(SELECT ${authSessions.browserSessionHash} FROM ${authSessions} WHERE ${authSessions.tokenHash}=${tokenHash})`;

/** Users and their short-lived access tokens, stored by token hash. */
export class AuthRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** Creates the user of a Telegram identity once; returns its id. */
  async upsertUser(tx: PoolClient, id: string, telegramId: string, now: number): Promise<string> {
    const [row] = await ormOn(tx)
      .insert(users)
      .values({ id, telegramId, createdAt: now })
      .onConflictDoUpdate({ target: users.telegramId, set: { telegramId: sql`excluded.telegram_id` } })
      .returning({ id: users.id });

    return row!.id;
  }

  async insertToken(tx: PoolClient, tokenHash: string, ownerId: string, expiresAt: number) {
    await ormOn(tx).insert(authSessions).values({ tokenHash, ownerId, expiresAt });
  }

  /** Stores a client link code by hash and drops expired ones. */
  async insertLink(codeHash: string, ownerId: string, expiresAt: number, now: number) {
    await this.db.orm.delete(clientLinks).where(lt(clientLinks.expiresAt, now));
    await this.db.orm.insert(clientLinks).values({ codeHash, ownerId, expiresAt });
  }

  /** Takes an unexpired link code once: its owner, or undefined when it is unknown, used or expired. */
  async takeLink(codeHash: string, now: number): Promise<string | undefined> {
    const [row] = await this.db.orm
      .delete(clientLinks)
      .where(and(eq(clientLinks.codeHash, codeHash), gt(clientLinks.expiresAt, now)))
      .returning({ ownerId: clientLinks.ownerId });

    return row?.ownerId;
  }

  async deleteExpiredTokens(tx: PoolClient, now: number) {
    await ormOn(tx).delete(authSessions).where(lt(authSessions.expiresAt, now));
  }

  /** The user an unexpired token hash belongs to, and when the token expires. */
  async principal(tokenHash: string, now: number) {
    const [row] = await this.db.orm
      .select({ id: users.id, telegram_id: users.telegramId, expires_at: authSessions.expiresAt })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.ownerId))
      .where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, now)));

    return row;
  }

  /**
   * The expiry of each given token hash that is still stored and unexpired; revoked and expired ones are absent.
   * Queries `AUTH_RECHECK_CHUNK` hashes at a time.
   */
  async unexpired(tokenHashes: readonly string[], now: number): Promise<Map<string, number>> {
    const found = new Map<string, number>();

    for (let start = 0; start < tokenHashes.length; start += AUTH_RECHECK_CHUNK) {
      const rows = await this.db.orm
        .select({ tokenHash: authSessions.tokenHash, expiresAt: authSessions.expiresAt })
        .from(authSessions)
        .where(
          and(
            inArray(authSessions.tokenHash, tokenHashes.slice(start, start + AUTH_RECHECK_CHUNK)),
            gt(authSessions.expiresAt, now),
          ),
        );

      for (const row of rows) {
        found.set(row.tokenHash, row.expiresAt);
      }
    }

    return found;
  }

  async lockToken(tx: PoolClient, tokenHash: string) {
    await ormOn(tx)
      .select({ tokenHash: authSessions.tokenHash })
      .from(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash))
      .for('update');
  }

  /** A token and every token issued from the same browser session. */
  async siblingTokens(tx: PoolClient, tokenHash: string): Promise<string[]> {
    const rows = await ormOn(tx)
      .select({ tokenHash: authSessions.tokenHash })
      .from(authSessions)
      .where(
        or(
          eq(authSessions.tokenHash, tokenHash),
          sql`${authSessions.browserSessionHash}=${browserSessionOf(tokenHash)}`,
        ),
      );

    return rows.map((row) => row.tokenHash);
  }

  async deleteBrowserSessionOf(tx: PoolClient, tokenHash: string) {
    await ormOn(tx)
      .delete(browserSessions)
      .where(sql`${browserSessions.tokenHash}=${browserSessionOf(tokenHash)}`);
  }

  async deleteToken(tx: PoolClient, tokenHash: string) {
    await ormOn(tx).delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
  }
}
