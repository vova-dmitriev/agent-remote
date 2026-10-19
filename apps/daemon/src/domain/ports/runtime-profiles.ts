import type { ProfileRequest, ProfileResponse } from '@protocol';

export interface ProfileScope {
  readonly ownerId: string;
  readonly deviceId: string;
}

/** Profile requests served by the runtime profile composition. */
export interface RuntimeProfilesPort {
  readonly scope: ProfileScope;
  request(input: ProfileRequest, current?: () => boolean): Promise<ProfileResponse>;
  close(): Promise<void>;
}
