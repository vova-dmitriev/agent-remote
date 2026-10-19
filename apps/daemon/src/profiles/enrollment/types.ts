import type { ExecutionProfileSummary, EnrollmentChallenge, ProfileOperation } from '@protocol';
import type { LocalDatabase } from '../../local/state/database.js';
import type { ProfileRegistry } from '../registry.js';
import type { ProfileScope, ProfileVerification } from '../types.js';

export interface CredentialEnrollmentOptions {
  database: LocalDatabase;
  directory: string;
  scope: ProfileScope;
  registry: ProfileRegistry;
  now?: () => number;
  apply: (
    secret: string,
    profile: ExecutionProfileSummary,
    current: () => boolean,
    operationId: string,
  ) => Promise<ProfileVerification>;
  check: (
    profile: ExecutionProfileSummary,
    current: () => boolean,
    operationId: string,
  ) => Promise<ProfileVerification>;
  hasNativeCloseProof?: (operationId: string, profileId: string, profileVersion: number) => boolean;
  forgetNativeCloseProof?: (operationId: string) => void;
  closeProfile?: (profileId: string) => Promise<boolean>;
}

export interface EnrollmentRecord {
  challenge: EnrollmentChallenge;
  consumed: boolean;
  cipherHash: string | null;
  keyRef: string | null;
}

export interface EnrollmentProgress {
  operation: ProfileOperation;
  apply: boolean;
}
