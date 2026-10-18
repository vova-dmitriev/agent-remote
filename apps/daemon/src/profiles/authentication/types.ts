import type { ExecutionProfileSummary, ProfileLogin } from '../../../../../packages/protocol/src/index.js';
import type { ProfileVerification } from '../types.js';
import type { ProfileRegistry } from '../registry.js';
import type { ProfileServiceOptions } from '../lifecycle/types.js';
import type { ProfileNativeOptions } from '../native/types.js';
import type { ProfileAuthenticationPool } from './pool.js';
import type { ProfileJournal } from '../lifecycle/journal.js';

export interface ProfileAuthenticationNative {
  loginSubscription(): Promise<ProfileLogin>;
  probe(): Promise<ProfileVerification>;
  close(): Promise<void>;
}

export interface ProfileAuthenticationEntry {
  version: number;
  opening: Promise<ProfileAuthenticationNative>;
  closing?: Promise<void>;
}

export interface ProfileAuthenticationOptions extends ProfileServiceOptions {
  registry: ProfileRegistry;
  baseEnvironment: NodeJS.ProcessEnv;
  native: ProfileNativeOptions;
  open?: (
    environment: NodeJS.ProcessEnv,
    profile: ExecutionProfileSummary,
    options: ProfileNativeOptions,
  ) => Promise<ProfileAuthenticationNative>;
}

export interface ProfileAuthenticationContext {
  options: ProfileAuthenticationOptions;
  pool: ProfileAuthenticationPool;
  journal: ProfileJournal;
  logins: Map<string, ProfileLogin>;
  active: Set<string>;
  starting: Map<string, Promise<boolean>>;
  closeProfile: (id: string) => Promise<void>;
}

export interface ProfileAuthenticationReconcileContext {
  options: ProfileAuthenticationOptions;
  pool: ProfileAuthenticationPool;
  journal: ProfileJournal;
  logins: Map<string, ProfileLogin>;
}
