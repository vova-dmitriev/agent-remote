import {
  ErrorCode,
  ProfileOperationPhase,
  ProfileStatus,
  type ProfileOperation,
  type ProfileLogin,
} from '@protocol';
import type { ProfileAuthenticationOptions } from './types.js';
import type { ProfileJournal } from '../lifecycle/journal.js';

export function assertProfileCaller(current: () => boolean) {
  if (!current()) {
    throw new Error(ErrorCode.UNAUTHORIZED);
  }
}

export function authenticationProfile(options: ProfileAuthenticationOptions, id: string, version: number) {
  const profile = options.registry.get(id);

  if (profile.ownerId !== options.scope.ownerId || profile.deviceId !== options.scope.deviceId) {
    throw new Error(ErrorCode.NOT_FOUND);
  }

  if (profile.version !== version) {
    throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
  }

  if (profile.status !== ProfileStatus.Ready && profile.status !== ProfileStatus.NeedsAuthentication) {
    throw new Error(ErrorCode.PROFILE_NOT_READY);
  }

  return profile;
}

export function saveAuthentication(
  journal: ProfileJournal,
  operation: ProfileOperation,
  phase: ProfileOperationPhase,
  code?: ErrorCode,
  profileVersion = operation.profileVersion,
) {
  return journal.save({
    ...operation,
    phase,
    code,
    profileVersion,
    version: operation.version + 1,
    updatedAt: Date.now(),
  });
}

export function discardProfileLogins(journal: ProfileJournal, logins: Map<string, ProfileLogin>, id: string) {
  for (const operationId of logins.keys()) {
    const operation = journal.get(operationId);

    if (operation.profileId !== id) {
      continue;
    }

    logins.delete(operationId);

    if (operation.phase === ProfileOperationPhase.AwaitingAuthentication) {
      saveAuthentication(journal, operation, ProfileOperationPhase.Failed, ErrorCode.LOCAL_REVISION_CONFLICT);
    }
  }
}
