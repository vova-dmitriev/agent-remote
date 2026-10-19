import { resolve } from 'node:path';
import { AgentProvider, ErrorCode, ProfileAuthMode } from '@protocol';
import type { ClaudeAuthenticationEvidence, VerifiedClaudeAuthentication } from './types.js';
import { ClaudeProfileError } from './values.js';

export function verifyClaudeAuthentication(
  profile: { provider: string; authMode: ProfileAuthMode },
  configDirectory: string,
  evidence: ClaudeAuthenticationEvidence,
): VerifiedClaudeAuthentication {
  if (profile.provider !== AgentProvider.Claude || profile.authMode !== evidence.authMode) {
    throw new Error(ErrorCode.PROFILE_MISMATCH);
  }

  if (resolve(configDirectory) !== resolve(evidence.configDirectory)) {
    throw new Error(ErrorCode.PROFILE_MISMATCH);
  }

  if (!evidence.authenticated || typeof evidence.accountRef !== 'string' || !evidence.accountRef.trim()) {
    throw new Error(ErrorCode.PROFILE_NOT_READY);
  }

  return { authMode: evidence.authMode, accountRef: evidence.accountRef };
}

export function subscriptionSignInBlocker() {
  return ClaudeProfileError.SubscriptionSignInNotWired;
}
