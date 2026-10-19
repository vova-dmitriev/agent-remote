import { immutableProfileScope } from '../storage/scope.js';
import { createHash } from 'node:crypto';
import {
  ErrorCode,
  ProfileLimits,
  ProfileOperationPhase,
  profileOperationSchema,
  type ProfileMutation,
  type BeginEnrollmentRequest,
  type ProfileAuthenticationRequest,
  type ProfileOperation,
} from '@protocol';
import type { LocalDatabase } from '../../local/state/database.js';
import type { ProfileScope } from '../types.js';

interface StoredOperation {
  fingerprint: string;
  value: string;
}

export class ProfileJournal {
  constructor(
    readonly database: LocalDatabase,
    private scope: ProfileScope,
  ) {
    this.scope = immutableProfileScope(scope);

    database.connection.exec(
      'CREATE TABLE IF NOT EXISTS profile_operations(owner TEXT NOT NULL,device TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(owner,device,id))',
    );
  }

  private row(id: string) {
    return this.database.connection
      .prepare('SELECT fingerprint,value FROM profile_operations WHERE owner=? AND device=? AND id=?')
      .get(this.scope.ownerId, this.scope.deviceId, id) as StoredOperation | undefined;
  }

  get(id: string): ProfileOperation {
    const row = this.row(id);

    if (!row) {
      throw new Error(ErrorCode.NOT_FOUND);
    }

    const operation = profileOperationSchema.parse(JSON.parse(row.value));

    if (operation.ownerId !== this.scope.ownerId || operation.deviceId !== this.scope.deviceId) {
      throw new Error(ErrorCode.NOT_FOUND);
    }

    return operation;
  }

  pending() {
    const rows = this.database.connection
      .prepare(
        "SELECT id FROM profile_operations WHERE owner=? AND device=? AND json_extract(value,'$.phase') NOT IN (?,?) ORDER BY json_extract(value,'$.updatedAt') DESC LIMIT ?",
      )
      .all(
        this.scope.ownerId,
        this.scope.deviceId,
        ProfileOperationPhase.Complete,
        ProfileOperationPhase.Failed,
        ProfileLimits.ActiveProfiles,
      ) as { id: string }[];

    return rows.map(({ id }) => this.get(id));
  }

  run(
    request: ProfileMutation | BeginEnrollmentRequest | ProfileAuthenticationRequest,
    work: () => ProfileOperation,
  ) {
    const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');

    return this.database.connection.transaction(() => {
      const row = this.row(request.operationId);

      if (row) {
        if (row.fingerprint !== fingerprint) {
          throw new Error(ErrorCode.PROFILE_OPERATION_REUSED);
        }

        return this.get(request.operationId);
      }

      const count = this.database.connection
        .prepare('SELECT COUNT(*) AS count FROM profile_operations WHERE owner=? AND device=?')
        .get(this.scope.ownerId, this.scope.deviceId) as { count: number };

      if (count.count >= ProfileLimits.Operations) {
        throw new Error(ErrorCode.PROFILE_LIMIT_REACHED);
      }

      const result = profileOperationSchema.parse(work());

      this.database.connection
        .prepare('INSERT INTO profile_operations VALUES(?,?,?,?,?)')
        .run(this.scope.ownerId, this.scope.deviceId, result.id, fingerprint, JSON.stringify(result));

      return result;
    })();
  }

  save(value: ProfileOperation) {
    const parsed = profileOperationSchema.parse(value);

    this.database.connection
      .prepare('UPDATE profile_operations SET value=? WHERE owner=? AND device=? AND id=?')
      .run(JSON.stringify(parsed), this.scope.ownerId, this.scope.deviceId, parsed.id);

    return parsed;
  }
}
