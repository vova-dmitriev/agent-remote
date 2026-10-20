import type { PoolClient } from 'pg';
import type { Database } from '../../db/database.js';

export interface PairingStatusRow {
  claim_id: string | null;
  telegram_id: string | null;
  expires_at: string;
}

export class PairingRepository {
  constructor(private readonly db: Database) {}

  async deleteExpired(now: number) {
    await this.db.pool.query('DELETE FROM pairings WHERE expires_at<$1', [now]);
  }

  async insert(codeHash: string, proofHash: string, expiresAt: number) {
    await this.db.pool.query('INSERT INTO pairings(code_hash,proof_hash,expires_at) VALUES($1,$2,$3)', [
      codeHash,
      proofHash,
      expiresAt,
    ]);
  }

  /** Claims an open pairing code for an owner; an owner re-claiming keeps the first claim id. */
  async claim(
    tx: PoolClient,
    ownerId: string,
    claimId: string,
    codeHash: string,
    now: number,
  ): Promise<string | undefined> {
    const row = await tx.query(
      'UPDATE pairings SET owner_id=$1,claim_id=COALESCE(claim_id,$2) WHERE code_hash=$3 AND (owner_id IS NULL OR owner_id=$1) AND consumed=false AND expires_at>$4 RETURNING claim_id',
      [ownerId, claimId, codeHash, now],
    );

    return row.rowCount ? (row.rows[0].claim_id as string) : undefined;
  }

  async cancel(proofHash: string) {
    await this.db.pool.query('UPDATE pairings SET consumed=true WHERE proof_hash=$1 AND consumed=false', [
      proofHash,
    ]);
  }

  async status(proofHash: string, now: number): Promise<PairingStatusRow | undefined> {
    return (
      await this.db.pool.query<PairingStatusRow>(
        'SELECT p.claim_id,u.telegram_id,p.expires_at FROM pairings p LEFT JOIN users u ON u.id=p.owner_id WHERE proof_hash=$1 AND consumed=false AND expires_at>$2',
        [proofHash, now],
      )
    ).rows[0];
  }

  /** Consumes a claimed pairing; returns the owner that claimed it. */
  async consume(
    tx: PoolClient,
    proofHash: string,
    claimId: string,
    now: number,
  ): Promise<string | undefined> {
    return (
      await tx.query<{ owner_id: string }>(
        'UPDATE pairings SET consumed=true WHERE proof_hash=$1 AND claim_id=$2 AND consumed=false AND expires_at>$3 RETURNING owner_id',
        [proofHash, claimId, now],
      )
    ).rows[0]?.owner_id;
  }
}
