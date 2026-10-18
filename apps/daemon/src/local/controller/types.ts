import type { HistoryMessage, HistoryRead, LocalAction } from '../../../../../packages/protocol/src/index.js';
import type { Monitor } from '../../monitor/monitor.js';
import type { LocalStore } from '../../monitor/store.js';
import type { AdapterRegistry } from '../../adapters/registry.js';
import type { Dispatcher } from '../../commands/dispatcher.js';
import type { LocalDocuments } from '../state/documents.js';
import type { LocalGrants } from '../grants/service.js';
import type { LocalPrincipal } from '../grants/types.js';
import type { RuntimeProfiles } from '../../profiles/runtime/service.js';

export interface LocalControllerOptions {
  ownerId: string;
  deviceId: string;
  monitor: Monitor;
  store: LocalStore;
  adapters: AdapterRegistry;
  dispatcher: Dispatcher;
  documents: LocalDocuments;
  grants: LocalGrants;
  profiles?: RuntimeProfiles;
  history?: (
    request: HistoryRead,
  ) => Promise<{ messages: HistoryMessage[]; before: string | null; after: string | null } | null>;
  media?: {
    execute(principal: LocalPrincipal, action: LocalAction): Promise<unknown>;
    close(): Promise<void>;
  };
}
