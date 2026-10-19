import { immutableProfileScope } from '../storage/scope.js';
import {
  ErrorCode,
  CredentialEnrollmentLimits,
  enrollmentChallengeSchema,
  type EnrollmentChallenge,
} from '@protocol';
import type { LocalDatabase } from '../../local/state/database.js';
import type { ProfileScope } from '../types.js';
import type { EnrollmentRecord } from './types.js';

interface StoredEnrollment {
  challenge: string;
  consumed: number;
  cipher_hash: string | null;
  key_ref: string | null;
}

export class EnrollmentRepository {
  constructor(
    private database: LocalDatabase,
    private scope: ProfileScope,
  ) {
    this.scope = immutableProfileScope(scope);

    database.connection.exec(`
      CREATE TABLE IF NOT EXISTS credential_enrollments(owner TEXT NOT NULL,device TEXT NOT NULL,id TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL,consumed INTEGER NOT NULL,cipher_hash TEXT,key_ref TEXT,PRIMARY KEY(owner,device,id));
      CREATE INDEX IF NOT EXISTS credential_enrollment_expiry ON credential_enrollments(owner,device,consumed,expires);
    `);
  }

  get(id: string): EnrollmentRecord {
    const row = this.database.connection
      .prepare(
        'SELECT challenge,consumed,cipher_hash,key_ref FROM credential_enrollments WHERE owner=? AND device=? AND id=?',
      )
      .get(this.scope.ownerId, this.scope.deviceId, id) as StoredEnrollment | undefined;

    if (!row) {
      throw new Error(ErrorCode.NOT_FOUND);
    }

    const challenge = enrollmentChallengeSchema.parse(JSON.parse(row.challenge));

    if (challenge.ownerId !== this.scope.ownerId || challenge.deviceId !== this.scope.deviceId) {
      throw new Error(ErrorCode.NOT_FOUND);
    }

    return { challenge, consumed: row.consumed === 1, cipherHash: row.cipher_hash, keyRef: row.key_ref };
  }

  create(challenge: EnrollmentChallenge, now: number) {
    const count = this.database.connection
      .prepare(
        'SELECT COUNT(*) AS count FROM credential_enrollments WHERE owner=? AND device=? AND consumed=0 AND expires>?',
      )
      .get(this.scope.ownerId, this.scope.deviceId, now) as { count: number };

    if (count.count >= CredentialEnrollmentLimits.ActiveChallenges) {
      throw new Error(ErrorCode.PROFILE_LIMIT_REACHED);
    }

    this.database.connection
      .prepare('INSERT INTO credential_enrollments VALUES(?,?,?,?,?,0,NULL,NULL)')
      .run(
        this.scope.ownerId,
        this.scope.deviceId,
        challenge.operationId,
        JSON.stringify(challenge),
        challenge.expiresAt,
      );
  }

  consume(id: string, cipherHash: string, keyRef: string) {
    const record = this.get(id);

    if (record.consumed) {
      if (record.cipherHash !== cipherHash) {
        throw new Error(ErrorCode.ENROLLMENT_REPLAYED);
      }

      return false;
    }

    const result = this.database.connection
      .prepare(
        'UPDATE credential_enrollments SET consumed=1,cipher_hash=?,key_ref=? WHERE owner=? AND device=? AND id=? AND consumed=0',
      )
      .run(cipherHash, keyRef, this.scope.ownerId, this.scope.deviceId, id);

    return result.changes === 1;
  }
}
