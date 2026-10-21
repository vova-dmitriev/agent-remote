import type { HistoryMessage, HistoryRead, LocalAction } from '@protocol';
import type { MonitorPort } from '../../domain/ports/monitor.js';
import type { LocalStorePort } from '../../domain/ports/local-store.js';
import type { AdapterRegistry } from '../../adapters/registry.js';
import type { Dispatcher } from '../../commands/dispatcher.js';
import type { LocalDocuments } from '../state/documents.js';
import type { LocalGrants } from '../grants/service.js';
import type { LocalPrincipal } from '../grants/types.js';
import type { RuntimeProfilesPort } from '../../domain/ports/runtime-profiles.js';
import type {
  ProjectSessionsPort,
  SessionModelPort,
  SessionNamesPort,
  SessionRemovalPort,
} from '../../domain/ports/session-names.js';
import type { AnalyticsPort } from '../../analytics/collector.js';
import type { RulesPort } from '../../rules/service.js';

export interface LocalControllerOptions {
  ownerId: string;
  deviceId: string;
  monitor: MonitorPort;
  store: LocalStorePort;
  adapters: AdapterRegistry;
  dispatcher: Dispatcher;
  documents: LocalDocuments;
  grants: LocalGrants;
  profiles?: RuntimeProfilesPort;
  /** Renames sessions in their agents; without it a rename stays a local label. */
  names?: SessionNamesPort;
  /** Hides, archives or ends sessions; without it the app cannot remove one. */
  removal?: SessionRemovalPort;
  /** Switches running sessions to another model; without it the app cannot switch one. */
  models?: SessionModelPort;
  /** Starts sessions in a shared machine's projects; without it the app starts sessions only beside others. */
  projects?: ProjectSessionsPort;
  /** The usage report; without it the app reports usage as unavailable. */
  analytics?: AnalyticsPort | undefined;
  /** The owner's rules for agents' commands. */
  rules?: RulesPort | undefined;
  history?: (
    request: HistoryRead,
  ) => Promise<{ messages: HistoryMessage[]; before: string | null; after: string | null } | null>;
  hasHistoryReader?: (sessionId: string) => boolean;
  media?: {
    execute(principal: LocalPrincipal, action: LocalAction): Promise<unknown>;
    close(): Promise<void>;
  };
}
