import type { ExecutionProfileSummary } from '../../../../../packages/protocol/src/index.js';
import type { LocalDatabase } from '../../local/state/database.js';
import type { ProfileScope } from '../types.js';

export interface ProfileServiceOptions {
  database: LocalDatabase;
  directory: string;
  scope: ProfileScope;
  cleanup?: (profile: ExecutionProfileSummary, current: () => boolean) => Promise<void>;
  executionActive?: (profileId: string) => boolean;
  waitForInactive?: (profileId: string, current: () => boolean) => Promise<void>;
}
