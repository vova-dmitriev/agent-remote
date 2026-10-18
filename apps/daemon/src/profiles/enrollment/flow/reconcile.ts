import { ErrorCode, ProfileOperationPhase } from '../../../../../../packages/protocol/src/index.js';
import { finishEnrollment, uncertainEnrollment } from './state.js';
import type { EnrollmentContext } from './types.js';

export async function reconcileCredentialEnrollment(
  context: EnrollmentContext,
  id: string,
  current: () => boolean,
) {
  if (!current()) {
    throw new Error(ErrorCode.UNAUTHORIZED);
  }

  const operation = context.journal.get(id);

  if (
    operation.phase === ProfileOperationPhase.AwaitingAuthentication &&
    context.repository.get(id).challenge.expiresAt <= context.now()
  ) {
    return context.journal.save({
      ...operation,
      phase: ProfileOperationPhase.Failed,
      code: ErrorCode.ENROLLMENT_EXPIRED,
      version: operation.version + 1,
      updatedAt: context.now(),
    });
  }

  if (
    context.active.has(id) ||
    (operation.phase !== ProfileOperationPhase.Preparing && operation.phase !== ProfileOperationPhase.Unknown)
  ) {
    return operation;
  }

  const profile = context.options.registry.get(operation.profileId);

  try {
    const proof = context.options.hasNativeCloseProof?.(id, profile.id, operation.profileVersion);

    if (!proof && !(await context.options.closeProfile?.(profile.id))) {
      return operation;
    }

    const evidence = await context.options.check(profile, current, id);

    if (!current()) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    return finishEnrollment(context, id, evidence);
  } catch (error) {
    if (!current()) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    return uncertainEnrollment(context, id, error);
  }
}
