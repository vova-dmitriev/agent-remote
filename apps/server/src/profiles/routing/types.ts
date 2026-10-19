import type { ProfileQuotaObservation } from '../../../../../packages/protocol/src/profile-quota.js';
import type {
  ProfileRoutingSettings,
  SaveProfileRouting,
} from '../../../../../packages/protocol/src/profile-routing.js';

export interface ProfileRoutingSnapshot {
  settings: ProfileRoutingSettings;
  observations: ProfileQuotaObservation[];
}

export type SaveRoutingRequest = SaveProfileRouting;
