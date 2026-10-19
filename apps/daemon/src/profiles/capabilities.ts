import { CapabilitySupport, CodedError, ErrorCode, type ExecutionProfileSummary } from '@protocol';
import { profileVerificationSchema, type ProfileVerification } from './types.js';

export function verifyProfileObservation(profile: ExecutionProfileSummary, input: ProfileVerification) {
  const observation = profileVerificationSchema.parse(input);

  if (
    profile.provider !== observation.provider ||
    profile.authMode !== observation.authMode ||
    (profile.identity &&
      (profile.identity.accountRef !== observation.identity?.accountRef ||
        profile.identity.workspaceRef !== observation.identity?.workspaceRef))
  ) {
    throw new CodedError(ErrorCode.PROFILE_MISMATCH);
  }

  if (!observation.identity || observation.capabilities.isolation !== CapabilitySupport.Supported) {
    throw new CodedError(ErrorCode.PROFILE_NOT_READY);
  }

  return observation;
}

export function unverifiedProfileCapabilities() {
  return {
    isolation: CapabilitySupport.Unknown,
    createSession: false,
    contextSeed: false,
    resume: false,
    quota: false,
  };
}
