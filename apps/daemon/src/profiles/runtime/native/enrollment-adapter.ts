import { CredentialEnrollmentService } from '../../enrollment/service.js';
import type { ProfileRegistry } from '../../registry.js';
import type { RuntimeProfileNative } from './native.js';
import type { RuntimeProfilesOptions } from '../types.js';

export function createRuntimeEnrollment(
  options: RuntimeProfilesOptions,
  registry: ProfileRegistry,
  native: RuntimeProfileNative,
) {
  return new CredentialEnrollmentService({
    ...options,
    registry,
    apply: (secret, profile, current, operationId) => native.verify(profile, current, secret, operationId),
    check: (profile, current, operationId) => native.verify(profile, current, undefined, operationId),
    hasNativeCloseProof: (operationId, profileId, profileVersion) =>
      native.hasCloseProof(operationId, profileId, profileVersion),
    forgetNativeCloseProof: (operationId) => native.forgetCloseProof(operationId),
    closeProfile: (profileId) => native.closeProfile(profileId),
  });
}
