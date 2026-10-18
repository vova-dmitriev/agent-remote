import {
  ErrorCode,
  ProfileAuthMode,
  ProfileStatus,
  ProfileOperationPhase,
  type ProfileOperation,
} from '../../../../../../packages/protocol/src/index.js';
import type { ProfileVerification } from '../../types.js';
import type { EnrollmentContext } from './types.js';

export function enrollmentProfile(context: EnrollmentContext, id: string, version: number) {
  const profile = context.options.registry.get(id);
  const scope = context.options.scope;

  if (profile.ownerId !== scope.ownerId || profile.deviceId !== scope.deviceId) {
    throw new Error(ErrorCode.NOT_FOUND);
  }

  if (profile.version !== version) {
    throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
  }

  if (
    profile.authMode !== ProfileAuthMode.ApiKey ||
    (profile.status !== ProfileStatus.Ready && profile.status !== ProfileStatus.NeedsAuthentication)
  ) {
    throw new Error(ErrorCode.PROFILE_NOT_READY);
  }

  return profile;
}

export function finishEnrollment(
  context: EnrollmentContext,
  id: string,
  evidence: ProfileVerification,
): ProfileOperation {
  return context.options.database.connection.transaction(() => {
    const operation = context.journal.get(id);

    if (operation.phase === ProfileOperationPhase.Complete) {
      return operation;
    }

    const record = context.repository.get(id);

    if (evidence.identity?.accountRef !== record.keyRef) {
      throw new Error(ErrorCode.PROFILE_MISMATCH);
    }

    const profile = context.options.registry.verify(operation.profileId, operation.profileVersion, evidence);

    return context.journal.save({
      ...operation,
      code: undefined,
      phase: ProfileOperationPhase.Complete,
      profileVersion: profile.version,
      version: operation.version + 1,
      updatedAt: context.now(),
    });
  })();
}

export function uncertainEnrollment(context: EnrollmentContext, id: string, failure: unknown) {
  return context.options.database.connection.transaction(() => {
    const operation = context.journal.get(id);

    if (operation.phase === ProfileOperationPhase.Complete) {
      return operation;
    }

    const code =
      Object.values(ErrorCode).find((value) => failure instanceof Error && value === failure.message) ??
      ErrorCode.REQUEST_FAILED;

    return context.journal.save({
      ...operation,
      phase: ProfileOperationPhase.Unknown,
      code,
      version: operation.version + 1,
      updatedAt: context.now(),
    });
  })();
}

export function cancelEnrollmentForRemoval(context: EnrollmentContext, id: string) {
  return context.options.database.connection.transaction(() => {
    const operation = context.journal.get(id);

    if (
      operation.phase === ProfileOperationPhase.Complete ||
      operation.phase === ProfileOperationPhase.Failed
    ) {
      return operation;
    }

    const profile = context.options.registry.get(operation.profileId);

    if (profile.status !== ProfileStatus.Removing && profile.status !== ProfileStatus.Removed) {
      throw new Error(ErrorCode.PROFILE_NOT_READY);
    }

    return context.journal.save({
      ...operation,
      phase: ProfileOperationPhase.Failed,
      code: ErrorCode.PROFILE_NOT_READY,
      version: operation.version + 1,
      updatedAt: context.now(),
    });
  })();
}
