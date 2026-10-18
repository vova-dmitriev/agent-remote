import type {
  ExecutionLaunchSelection,
  ExecutionProfileSummary,
} from '../../../../../packages/protocol/src/index.js';
import type { ProfileRegistry } from '../../profiles/registry.js';
import type { ProfileVerification } from '../../profiles/types.js';

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

export interface ExecutionOwnershipLease {
  readonly id: string;
  bindSocket(path: string): void;
  bindProcess(pid: number): void;
  processId(): number | undefined;
  markReady(): void;
  releaseBeforeLaunch(): boolean;
  releaseAfterExit(): boolean;
}

export interface ProfiledExecutionLaunch extends TrustedExecutionLaunch {
  executionLease: ExecutionOwnershipLease;
}
