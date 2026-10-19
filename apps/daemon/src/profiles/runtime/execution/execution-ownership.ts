import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { ErrorCode, ProfileStatus } from '@protocol';
import type { LocalDatabase } from '../../../local/state/database.js';
import { immutableProfileScope } from '../../storage/scope.js';
import type { ProfileRegistry } from '../../registry.js';
import type { ProfileScope } from '../../types.js';
import type { ExecutionOwnershipLease } from '../../../sessions/execution/types.js';
import {
  ExecutionOwnershipKind,
  type ExecutionChildState as ChildState,
  type ExecutionOwnershipKind as OwnershipKind,
} from './execution-values.js';
import { createExecutionReferenceSchema } from './execution-schema.js';
import { reconcileExecutionReferences } from './execution-recovery.js';
import { ProfileExecutionMutationGuard, type CredentialMutationLease } from './execution-mutations.js';

export class ProfileExecutionOwnership {
  private scope: ProfileScope;
  private mutations: ProfileExecutionMutationGuard;

  constructor(
    private database: LocalDatabase,
    scope: ProfileScope,
    private registry: ProfileRegistry,
  ) {
    this.scope = immutableProfileScope(scope);
    this.mutations = new ProfileExecutionMutationGuard(database, scope, registry);
    createExecutionReferenceSchema(this.database);
  }

  reserve(profileId: string, expectedVersion: number): ExecutionOwnershipLease {
    const id = randomUUID();

    const insert = this.database.connection.transaction(() => {
      if (this.hasKind(profileId, ExecutionOwnershipKind.Mutation)) {
        throw new Error(ErrorCode.PROFILE_EXECUTION_ACTIVE);
      }

      const profile = this.registry.get(profileId);

      if (profile.status === ProfileStatus.Removing || profile.status === ProfileStatus.Removed) {
        throw new Error(ErrorCode.PROFILE_NOT_READY);
      }

      if (profile.version !== expectedVersion) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      this.database.connection
        .prepare(
          'INSERT INTO profile_execution_refs(owner,device,profile,ref,socket,pid,ready,kind,operation,created) VALUES(?,?,?, ?,NULL,NULL,0,?,NULL,?)',
        )
        .run(
          this.scope.ownerId,
          this.scope.deviceId,
          profileId,
          id,
          ExecutionOwnershipKind.Execution,
          Date.now(),
        );
    });

    insert();

    const release = () => this.release(id);

    return Object.freeze({
      id,
      bindSocket: (path: string) => {
        if (!isAbsolute(path)) {
          throw new Error(ErrorCode.CODEX_INVALID_SOCKET);
        }

        this.database.connection
          .prepare(
            'UPDATE profile_execution_refs SET socket=?,ready=0 WHERE owner=? AND device=? AND ref=? AND kind=?',
          )
          .run(path, this.scope.ownerId, this.scope.deviceId, id, ExecutionOwnershipKind.Execution);
      },
      bindProcess: (pid: number) => {
        if (!Number.isSafeInteger(pid) || pid <= 0) {
          throw new Error(ErrorCode.CODEX_DAEMON_START_FAILED);
        }

        this.database.connection
          .prepare('UPDATE profile_execution_refs SET pid=? WHERE owner=? AND device=? AND ref=? AND kind=?')
          .run(pid, this.scope.ownerId, this.scope.deviceId, id, ExecutionOwnershipKind.Execution);
      },
      processId: () => {
        const row = this.database.connection
          .prepare('SELECT pid FROM profile_execution_refs WHERE owner=? AND device=? AND ref=?')
          .get(this.scope.ownerId, this.scope.deviceId, id) as { pid: number | null } | undefined;

        return row?.pid ?? undefined;
      },
      markReady: () => {
        this.database.connection
          .prepare(
            'UPDATE profile_execution_refs SET ready=1 WHERE owner=? AND device=? AND ref=? AND kind=?',
          )
          .run(this.scope.ownerId, this.scope.deviceId, id, ExecutionOwnershipKind.Execution);
      },
      releaseBeforeLaunch: release,
      releaseAfterExit: release,
    });
  }

  reserveMutation(profileId: string, expectedVersion: number, operationId: string): CredentialMutationLease {
    return this.mutations.reserveMutation(profileId, expectedVersion, operationId);
  }

  isActive(profileId: string): boolean {
    return this.mutations.isActive(profileId);
  }

  mutationOperations(profileId: string): string[] {
    return this.database.connection
      .prepare(
        'SELECT operation FROM profile_execution_refs WHERE owner=? AND device=? AND profile=? AND kind=? AND operation IS NOT NULL',
      )
      .all(this.scope.ownerId, this.scope.deviceId, profileId, ExecutionOwnershipKind.Mutation)
      .map((row) => (row as { operation: string }).operation);
  }

  hasMutation(profileId: string, operationId: string): boolean {
    return this.mutations.hasMutation(profileId, operationId);
  }

  async reconcileExited(probe: (pid: number) => Promise<ChildState>): Promise<void> {
    await reconcileExecutionReferences(this.database, this.scope, probe, (id) => this.release(id));
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
