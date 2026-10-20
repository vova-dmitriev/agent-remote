import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn, type Database } from '../../db/database.js';
import { pairings, users } from '../../db/schema/index.js';

export interface PairingStatusRow {
  claim_id: string | null;
  telegram_id: string | null;
  expires_at: number;
}

/** Open: not consumed and not expired at `now`. */
const open = (now: number) => and(eq(pairings.consumed, false), gt(pairings.expiresAt, now))!;

export class PairingRepository {
  constructor(private readonly db: Database) {}

  async deleteExpired(now: number) {
    await this.db.orm.delete(pairings).where(lt(pairings.expiresAt, now));
  }

  async insert(codeHash: string, proofHash: string, expiresAt: number) {
    await this.db.orm.insert(pairings).values({ codeHash, proofHash, expiresAt });
  }

  /** Claims an open pairing code for an owner; an owner re-claiming keeps the first claim id. */
  async claim(
    tx: PoolClient,
    ownerId: string,
    claimId: string,
    codeHash: string,
    now: number,
  ): Promise<string | undefined> {
    const [row] = await ormOn(tx)
      .update(pairings)
      .set({ ownerId, claimId: sql`coalesce(${pairings.claimId}, ${claimId})` })
      .where(
        and(
          eq(pairings.codeHash, codeHash),
          or(isNull(pairings.ownerId), eq(pairings.ownerId, ownerId)),
          open(now),
        ),
      )
      .returning({ claimId: pairings.claimId });

    return row?.claimId ?? undefined;
  }

  async cancel(proofHash: string) {
    await this.db.orm
      .update(pairings)
      .set({ consumed: true })
      .where(and(eq(pairings.proofHash, proofHash), eq(pairings.consumed, false)));
  }

  async status(proofHash: string, now: number): Promise<PairingStatusRow | undefined> {
    const [row] = await this.db.orm
      .select({ claim_id: pairings.claimId, telegram_id: users.telegramId, expires_at: pairings.expiresAt })
      .from(pairings)
      .leftJoin(users, eq(users.id, pairings.ownerId))
      .where(and(eq(pairings.proofHash, proofHash), open(now)));

    return row;
  }

  /** Consumes a claimed pairing; returns the owner that claimed it. */
  async consume(
    tx: PoolClient,
    proofHash: string,
    claimId: string,
    now: number,
  ): Promise<string | undefined> {
    const [row] = await ormOn(tx)
      .update(pairings)
      .set({ consumed: true })
      .where(and(eq(pairings.proofHash, proofHash), eq(pairings.claimId, claimId), open(now)))
      .returning({ ownerId: pairings.ownerId });

    return row?.ownerId ?? undefined;
  }
}
