import { randomUUID } from 'node:crypto';
import { ErrorCode, ProfileStatus } from '@protocol';
import type { LocalDatabase } from '../../local/state/database.js';
import { immutableProfileScope } from '../storage/scope.js';
import type { ProfileRegistry } from '../registry.js';
import type { ProfileScope } from '../types.js';
import { ExecutionOwnershipKind, type ExecutionOwnershipKind as OwnershipKind } from './execution-values.js';

export interface CredentialMutationLease {
  readonly id: string;
  releaseTerminal(): boolean;
}

export class ProfileExecutionMutationGuard {
  private scope: ProfileScope;

  constructor(
    private database: LocalDatabase,
    scope: ProfileScope,
    private registry: ProfileRegistry,
  ) {
    this.scope = immutableProfileScope(scope);
  }

  reserveMutation(profileId: string, expectedVersion: number, operationId: string): CredentialMutationLease {
    const id = this.database.connection.transaction(() => {
      const existing = this.database.connection
        .prepare(
          'SELECT ref FROM profile_execution_refs WHERE owner=? AND device=? AND profile=? AND kind=? AND operation=? LIMIT 1',
        )
        .get(
          this.scope.ownerId,
          this.scope.deviceId,
          profileId,
          ExecutionOwnershipKind.Mutation,
          operationId,
        ) as { ref: string } | undefined;

      if (existing) {
        if (this.hasKind(profileId, ExecutionOwnershipKind.Execution)) {
          throw new Error(ErrorCode.PROFILE_EXECUTION_ACTIVE);
        }

        return existing.ref;
      }

      if (
        this.hasKind(profileId, ExecutionOwnershipKind.Execution) ||
        this.hasKind(profileId, ExecutionOwnershipKind.Mutation)
      ) {
        throw new Error(ErrorCode.PROFILE_EXECUTION_ACTIVE);
      }

      const recorded = this.database.connection
        .prepare(
          "SELECT json_extract(value,'$.profileId') AS profile FROM profile_operations WHERE owner=? AND device=? AND id=?",
        )
        .get(this.scope.ownerId, this.scope.deviceId, operationId) as { profile: string | null } | undefined;

      if (recorded?.profile && recorded.profile !== profileId) {
        throw new Error(ErrorCode.PROFILE_OPERATION_REUSED);
      }

      const profile = this.registry.get(profileId);

      if (profile.status === ProfileStatus.Removing || profile.status === ProfileStatus.Removed) {
        throw new Error(ErrorCode.PROFILE_NOT_READY);
      }

      if (profile.version !== expectedVersion) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      const reference = randomUUID();

      this.database.connection
        .prepare(
          'INSERT INTO profile_execution_refs(owner,device,profile,ref,socket,pid,ready,kind,operation,created) VALUES(?,?,?, ?,NULL,NULL,0,?,?,?)',
        )
        .run(
          this.scope.ownerId,
          this.scope.deviceId,
          profileId,
          reference,
          ExecutionOwnershipKind.Mutation,
          operationId,
          Date.now(),
        );

      return reference;
    })();

    return Object.freeze({ id, releaseTerminal: () => this.release(id) });
  }

  isActive(profileId: string): boolean {
    return Boolean(
      this.database.connection
        .prepare('SELECT 1 FROM profile_execution_refs WHERE owner=? AND device=? AND profile=? LIMIT 1')
        .get(this.scope.ownerId, this.scope.deviceId, profileId),
    );
  }

  hasMutation(profileId: string, operationId: string): boolean {
    return Boolean(
      this.database.connection
        .prepare(
          'SELECT 1 FROM profile_execution_refs WHERE owner=? AND device=? AND profile=? AND kind=? AND operation=? LIMIT 1',
        )
        .get(
          this.scope.ownerId,
          this.scope.deviceId,
          profileId,
          ExecutionOwnershipKind.Mutation,
          operationId,
        ),
    );
  }

  private hasKind(profileId: string, kind: OwnershipKind): boolean {
    return Boolean(
      this.database.connection
        .prepare(
          'SELECT 1 FROM profile_execution_refs WHERE owner=? AND device=? AND profile=? AND kind=? LIMIT 1',
        )
        .get(this.scope.ownerId, this.scope.deviceId, profileId, kind),
    );
  }

  private release(id: string): boolean {
    if (!this.database.connection.open) {
      return false;
    }

    return (
      this.database.connection
        .prepare('DELETE FROM profile_execution_refs WHERE owner=? AND device=? AND ref=?')
        .run(this.scope.ownerId, this.scope.deviceId, id).changes > 0
    );
  }
}
