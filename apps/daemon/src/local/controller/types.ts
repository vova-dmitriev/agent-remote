import type { HistoryMessage, HistoryRead, LocalAction } from '@protocol';
import type { MonitorPort } from '../../domain/ports/monitor.js';
import type { LocalStorePort } from '../../domain/ports/local-store.js';
import type { AdapterRegistry } from '../../adapters/registry.js';
import type { Dispatcher } from '../../commands/dispatcher.js';
import type { LocalDocuments } from '../state/documents.js';
import type { LocalGrants } from '../grants/service.js';
import type { LocalPrincipal } from '../grants/types.js';
import type { RuntimeProfilesPort } from '../../domain/ports/runtime-profiles.js';

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
  history?: (
    request: HistoryRead,
  ) => Promise<{ messages: HistoryMessage[]; before: string | null; after: string | null } | null>;
  media?: {
    execute(principal: LocalPrincipal, action: LocalAction): Promise<unknown>;
    close(): Promise<void>;
  };
}
