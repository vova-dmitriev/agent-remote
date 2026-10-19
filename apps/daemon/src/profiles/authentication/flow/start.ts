import {
  CodedError,
  ErrorCode,
  knownErrorCode,
  profileLoginSchema,
  type ProfileOperation,
  ProfileOperationPhase,
} from '@protocol';
import { assertProfileCaller, authenticationProfile, saveAuthentication } from '../state.js';
import type { ProfileAuthenticationContext } from '../types.js';

export async function startProfileAuthentication(
  context: ProfileAuthenticationContext,
  operation: ProfileOperation,
  current: () => boolean,
) {
  let resolveStarting!: (closedPrevious: boolean) => void;
  const starting = new Promise<boolean>((resolve) => (resolveStarting = resolve));
  let initialCloseConfirmed = false;

  context.active.add(operation.id);
  context.starting.set(operation.id, starting);

  try {
    await context.closeProfile(operation.profileId);
    initialCloseConfirmed = true;
    resolveStarting(true);
    const native = await context.pool.open(operation.profileId, operation.profileVersion, current);
    const login = profileLoginSchema.parse(await native.loginSubscription());

    assertProfileCaller(current);
    authenticationProfile(context.options, operation.profileId, operation.profileVersion);
    context.logins.set(operation.id, login);

    return {
      operation: saveAuthentication(context.journal, operation, ProfileOperationPhase.AwaitingAuthentication),
      login,
    };
  } catch (error) {
    context.logins.delete(operation.id);
    const closed = await context.pool.close(operation.profileId, operation.profileVersion);
    const latest = context.journal.get(operation.id);

    if (latest.phase === ProfileOperationPhase.Complete || latest.phase === ProfileOperationPhase.Failed) {
      return { operation: latest };
    }

    if (!closed && !initialCloseConfirmed) {
      throw error;
    }

    const failed = saveAuthentication(
      context.journal,
      operation,
      ProfileOperationPhase.Failed,
      knownErrorCode(error),
    );

    if (!current()) {
      throw new CodedError(ErrorCode.UNAUTHORIZED, { cause: failed });
    }

    return { operation: failed };
  } finally {
    resolveStarting(initialCloseConfirmed);

    if (context.starting.get(operation.id) === starting) {
      context.starting.delete(operation.id);
    }

    context.active.delete(operation.id);
  }
}
