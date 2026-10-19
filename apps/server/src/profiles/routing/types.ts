import type { ProfileQuotaObservation, ProfileRoutingSettings, SaveProfileRouting } from '@protocol';

export interface ProfileRoutingSnapshot {
  settings: ProfileRoutingSettings;
  observations: ProfileQuotaObservation[];
}

export type SaveRoutingRequest = SaveProfileRouting;
