import type { ProfileServiceOptions } from '../lifecycle/types.js';
import type { ProfileNativeOptions } from '../native/types.js';
import type { CodexProfileNative } from '../native/codex.js';
import type { RuntimeProfileCloseProofStatus } from './close-proof-values.js';

export interface RuntimeProfileHandle {
  opening: Promise<CodexProfileNative>;
  closing?: Promise<void>;
}

export interface RuntimeProfileVerification {
  finished: Promise<void>;
  finish(): void;
}

export interface RuntimeProfileCloseProof {
  profileId: string;
  profileVersion: number;
  status: RuntimeProfileCloseProofStatus;
}

export interface RuntimeProfileConfiguration {
  inputEnabled: boolean;
  baseEnvironment: NodeJS.ProcessEnv;
  native: ProfileNativeOptions;
}

export interface RuntimeProfilesOptions extends ProfileServiceOptions, RuntimeProfileConfiguration {}
