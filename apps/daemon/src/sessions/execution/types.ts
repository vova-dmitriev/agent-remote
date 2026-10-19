import type { ExecutionLaunchSelection, ExecutionProfileSummary } from '@protocol';
import type { ProfileRegistry } from '../../profiles/registry.js';
import type { ProfileVerification } from '../../profiles/types.js';
import type { ExecutionOwnershipLease } from '../../domain/ports/execution-lease.js';

export interface ExecutionLaunchOptions {
  registry: ProfileRegistry;
  directory: string;
  baseEnvironment: NodeJS.ProcessEnv;
  verify: (profile: ExecutionProfileSummary, current: () => boolean) => Promise<ProfileVerification>;
}

export interface TrustedExecutionLaunch {
  profile: ExecutionProfileSummary;
  selection: ExecutionLaunchSelection;
  environment: NodeJS.ProcessEnv;
  assertCurrent: () => void;
}

export interface ProfiledExecutionLaunch extends TrustedExecutionLaunch {
  executionLease: ExecutionOwnershipLease;
}
