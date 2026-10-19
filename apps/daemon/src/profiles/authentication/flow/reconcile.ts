import {
  CodedError,
  ErrorCode,
  knownErrorCode,
  ProfileAction,
  type ProfileOperation,
  ProfileOperationPhase,
  ProfileStatus,
} from '@protocol';
import type { ProfileVerification } from '../../types.js';
import { assertProfileCaller, authenticationProfile, saveAuthentication } from '../state.js';
import type { ProfileAuthenticationReconcileContext } from '../types.js';

export async function reconcileProfileAuthentication(
  context: ProfileAuthenticationReconcileContext,
  operation: ProfileOperation,
  current: () => boolean,
): Promise<ProfileOperation> {
  let waiting = false;
  let evidence: ProfileVerification | undefined;
  let failure: unknown;

  try {
    const native = await context.pool.open(operation.profileId, operation.profileVersion, current);

    evidence = await native.probe();
  } catch (error) {
    failure = error;

    waiting =
      operation.action === ProfileAction.SignIn && knownErrorCode(error) === ErrorCode.PROFILE_NOT_READY;
  }

  if (waiting) {
    const waitingOperation = context.options.database.connection.transaction(() => {
      const latest = context.journal.get(operation.id);

      if (latest.phase === ProfileOperationPhase.Complete || latest.phase === ProfileOperationPhase.Failed) {
        return latest;
      }

      const profile = context.options.registry.get(operation.profileId);

      if (
        !current() ||
        latest.version !== operation.version ||
        profile.version !== latest.profileVersion ||
        profile.status === ProfileStatus.Removing ||
        profile.status === ProfileStatus.Removed
      ) {
        return null;
      }

      return saveAuthentication(
        context.journal,
        latest,
        ProfileOperationPhase.AwaitingAuthentication,
        ErrorCode.PROFILE_NOT_READY,
      );
    })();

    if (waitingOperation) {
      return waitingOperation;
    }

    const latest = context.journal.get(operation.id);

    if (latest.phase === ProfileOperationPhase.Complete || latest.phase === ProfileOperationPhase.Failed) {
      return latest;
    }

    const profile = context.options.registry.get(operation.profileId);
    const removing = profile.status === ProfileStatus.Removing || profile.status === ProfileStatus.Removed;

    if (!removing && profile.version === latest.profileVersion) {
      return latest;
    }

    const closed = await context.pool.close(operation.profileId, operation.profileVersion);
    const afterClose = context.journal.get(operation.id);

    if (
      afterClose.phase === ProfileOperationPhase.Complete ||
      afterClose.phase === ProfileOperationPhase.Failed
    ) {
      return afterClose;
    }

    if (!closed) {
      throw new CodedError(ErrorCode.PROFILE_EXECUTION_ACTIVE);
    }

    return saveAuthentication(
      context.journal,
      afterClose,
      ProfileOperationPhase.Failed,
      removing ? ErrorCode.PROFILE_NOT_READY : ErrorCode.LOCAL_REVISION_CONFLICT,
    );
  }

  context.logins.delete(operation.id);
  const closed = await context.pool.close(operation.profileId, operation.profileVersion);
  const latest = context.journal.get(operation.id);

  if (!closed) {
    if (latest.phase === ProfileOperationPhase.Complete || latest.phase === ProfileOperationPhase.Failed) {
      return latest;
    }

    throw new CodedError(ErrorCode.PROFILE_EXECUTION_ACTIVE);
  }

  if (latest.phase === ProfileOperationPhase.Complete || latest.phase === ProfileOperationPhase.Failed) {
    return latest;
  }

  const profile = context.options.registry.get(operation.profileId);

  if (profile.status === ProfileStatus.Removing || profile.status === ProfileStatus.Removed) {
    return saveAuthentication(
      context.journal,
      latest,
      ProfileOperationPhase.Failed,
      ErrorCode.PROFILE_NOT_READY,
    );
  }

  if (!current()) {
    const saved = saveAuthentication(
      context.journal,
      latest,
      ProfileOperationPhase.Failed,
      ErrorCode.UNAUTHORIZED,
    );

    throw new CodedError(ErrorCode.UNAUTHORIZED, { cause: saved });
  }

  if (failure !== undefined) {
    const code = knownErrorCode(failure);
    let version = latest.profileVersion;

    if (profile.version === version && profile.status === ProfileStatus.Ready) {
      version = context.options.registry.authenticationRequired(profile.id, version).version;
    }

    return saveAuthentication(context.journal, latest, ProfileOperationPhase.Failed, code, version);
  }

  try {
    assertProfileCaller(current);
    authenticationProfile(context.options, operation.profileId, operation.profileVersion);

    return context.options.database.connection.transaction(() => {
      const verified = context.options.registry.verify(
        operation.profileId,
        operation.profileVersion,
        evidence!,
      );

      return saveAuthentication(
        context.journal,
        latest,
        ProfileOperationPhase.Complete,
        undefined,
        verified.version,
      );
    })();
  } catch (error) {
    const saved = saveAuthentication(
      context.journal,
      latest,
      ProfileOperationPhase.Failed,
      knownErrorCode(error),
    );

    if (!current()) {
      throw new CodedError(ErrorCode.UNAUTHORIZED, { cause: saved });
    }

    return saved;
  }
}
