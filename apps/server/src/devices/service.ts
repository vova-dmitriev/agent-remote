import { ErrorCode } from '@protocol';
import { randomUUID } from 'node:crypto';
import { type Database } from '../db/database.js';
import { Fault, hash, secret, type Principal } from '../auth/security.js';

export interface DeviceRecord {
  id: string;
  owner_id: string;
  generation: string;
  revoked_at: string | null;
  last_seen_at: string;
  snapshot: unknown;
  connectors: unknown;
}
export class DeviceService {
  constructor(private db: Database) {}
  async owned(p: Principal, id: string): Promise<DeviceRecord> {
    const row = (
      await this.db.pool.query<DeviceRecord>(
        'SELECT id,owner_id,generation,revoked_at,last_seen_at,snapshot,connectors FROM devices WHERE owner_id=$1 AND id=$2 AND revoked_at IS NULL',
        [p.userId, id],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND, 404);
    }

    return row;
  }
  async authenticate(token: string): Promise<DeviceRecord> {
    const row = (
      await this.db.pool.query<DeviceRecord>(
        'SELECT id,owner_id,generation,revoked_at,last_seen_at,snapshot,connectors FROM devices WHERE token_hash=$1 AND revoked_at IS NULL',
        [hash(token)],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ErrorCode.UNAUTHORIZED, 401);
    }

    return row;
  }
  async list(p: Principal) {
    return (
      await this.db.pool.query(
        'SELECT id,last_seen_at FROM devices WHERE owner_id=$1 AND revoked_at IS NULL',
        [p.userId],
      )
    ).rows;
  }
  async start(codeHash: string, proofHash: string) {
    const expiresAt = Date.now() + 300000;

    await this.db.pool.query('DELETE FROM pairings WHERE expires_at<$1', [Date.now()]);

    await this.db.pool.query('INSERT INTO pairings(code_hash,proof_hash,expires_at) VALUES($1,$2,$3)', [
      codeHash,
      proofHash,
      expiresAt,
    ]);

    return { expiresAt };
  }
  async claim(p: Principal, code: string) {
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [p.userId]);

      if (
        (await tx.query('SELECT id FROM devices WHERE owner_id=$1 AND revoked_at IS NULL', [p.userId]))
          .rowCount
      ) {
        throw new Fault(ErrorCode.DEVICE_QUOTA, 409);
      }

      const claimId = randomUUID();

      const row = await tx.query(
        'UPDATE pairings SET owner_id=$1,claim_id=COALESCE(claim_id,$2) WHERE code_hash=$3 AND (owner_id IS NULL OR owner_id=$1) AND consumed=false AND expires_at>$4 RETURNING claim_id',
        [p.userId, claimId, hash(code), Date.now()],
      );

      if (!row.rowCount) {
        throw new Fault(ErrorCode.PAIRING_UNAVAILABLE, 409);
      }

      return { claimId: row.rows[0].claim_id as string };
    });
  }
  async cancel(proof: string) {
    await this.db.pool.query('UPDATE pairings SET consumed=true WHERE proof_hash=$1 AND consumed=false', [
      hash(proof),
    ]);

    return {};
  }
  async status(proof: string) {
    const row = (
      await this.db.pool.query<{ claim_id: string | null; telegram_id: string | null; expires_at: string }>(
        'SELECT p.claim_id,u.telegram_id,p.expires_at FROM pairings p LEFT JOIN users u ON u.id=p.owner_id WHERE proof_hash=$1 AND consumed=false AND expires_at>$2',
        [hash(proof), Date.now()],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND, 404);
    }

    return { claimId: row.claim_id, telegramId: row.telegram_id, expiresAt: Number(row.expires_at) };
  }
  async confirm(proof: string, claimId: string, approved: boolean) {
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query<{ owner_id: string }>(
          'UPDATE pairings SET consumed=true WHERE proof_hash=$1 AND claim_id=$2 AND consumed=false AND expires_at>$3 RETURNING owner_id',
          [hash(proof), claimId, Date.now()],
        )
      ).rows[0];

      if (!row) {
        throw new Fault(ErrorCode.NOT_FOUND, 404);
      }

      if (!approved) {
        return null;
      }

      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [row.owner_id]);

      if (
        (await tx.query('SELECT id FROM devices WHERE owner_id=$1 AND revoked_at IS NULL', [row.owner_id]))
          .rowCount
      ) {
        throw new Fault(ErrorCode.DEVICE_QUOTA, 409);
      }

      const deviceId = randomUUID(),
        token = secret();

      await tx.query('INSERT INTO devices(id,owner_id,token_hash,generation) VALUES($1,$2,$3,$4)', [
        deviceId,
        row.owner_id,
        hash(token),
        randomUUID(),
      ]);

      return { deviceId, token };
    });
  }
  async revoke(p: Principal, id: string) {
    await this.owned(p, id);

    await this.db.pool.query(
      "UPDATE devices SET revoked_at=$1,snapshot=NULL,connectors='[]' WHERE owner_id=$2 AND id=$3",
      [Date.now(), p.userId, id],
    );
  }
}
