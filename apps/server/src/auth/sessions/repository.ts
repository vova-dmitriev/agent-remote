import { and, eq, gt, lte } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn, type Database } from '../../db/database.js';
import { authSessions, browserSessions, users } from '../../db/schema/index.js';

/** Long-lived browser sessions and the access tokens they issue, stored by hash. */
export class BrowserSessionRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** Locks an unexpired access token; returns its owner. */
  async lockAccess(tx: PoolClient, accessHash: string, now: number): Promise<string | undefined> {
    const [row] = await ormOn(tx)
      .select({ ownerId: authSessions.ownerId })
      .from(authSessions)
      .where(and(eq(authSessions.tokenHash, accessHash), gt(authSessions.expiresAt, now)))
      .for('update');

    return row?.ownerId;
  }

  async insert(tx: PoolClient, credentialHash: string, ownerId: string, expiresAt: number) {
    await ormOn(tx).insert(browserSessions).values({ tokenHash: credentialHash, ownerId, expiresAt });
  }

  async linkAccess(tx: PoolClient, credentialHash: string, accessHash: string) {
    await ormOn(tx)
      .update(authSessions)
      .set({ browserSessionHash: credentialHash })
      .where(eq(authSessions.tokenHash, accessHash));
  }

  async deleteExpired(tx: PoolClient, now: number) {
    await ormOn(tx).delete(browserSessions).where(lte(browserSessions.expiresAt, now));
  }

  /** Locks a browser session; returns whether it exists. */
  async lock(tx: PoolClient, credentialHash: string): Promise<boolean> {
    const rows = await ormOn(tx)
      .select({ tokenHash: browserSessions.tokenHash })
      .from(browserSessions)
      .where(eq(browserSessions.tokenHash, credentialHash))
      .for('update');

    return rows.length > 0;
  }

  async accessTokens(tx: PoolClient, credentialHash: string): Promise<string[]> {
    const rows = await ormOn(tx)
      .select({ tokenHash: authSessions.tokenHash })
      .from(authSessions)
      .where(eq(authSessions.browserSessionHash, credentialHash));

    return rows.map((row) => row.tokenHash);
  }

  async delete(tx: PoolClient, credentialHash: string) {
    await ormOn(tx).delete(browserSessions).where(eq(browserSessions.tokenHash, credentialHash));
  }

  /** Locks an unexpired browser session with its owner's Telegram identity. */
  async lockForRefresh(tx: PoolClient, credentialHash: string, now: number) {
    const [row] = await ormOn(tx)
      .select({
        owner_id: browserSessions.ownerId,
        expires_at: browserSessions.expiresAt,
        telegram_id: users.telegramId,
      })
      .from(browserSessions)
      .innerJoin(users, eq(users.id, browserSessions.ownerId))
      .where(and(eq(browserSessions.tokenHash, credentialHash), gt(browserSessions.expiresAt, now)))
      .for('update', { of: browserSessions });

    return row;
  }

  async insertAccess(
    tx: PoolClient,
    tokenHash: string,
    ownerId: string,
    expiresAt: number,
    credentialHash: string,
  ) {
    await ormOn(tx)
      .insert(authSessions)
      .values({ tokenHash, ownerId, expiresAt, browserSessionHash: credentialHash });
  }

  async deleteExpiredAccess(tx: PoolClient, now: number) {
    await ormOn(tx).delete(authSessions).where(lte(authSessions.expiresAt, now));
  }
}
