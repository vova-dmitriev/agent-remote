import { join } from 'node:path';
import { browserSettings, type runtimeConfiguration } from '../../local/bootstrap/configuration.js';
import { localClientSecret } from '../../local/bootstrap/identity.js';
import type { LocalServices } from '../services/local-services.js';
import { LocalController } from '../../local/controller/controller.js';
import type { LocalControllerOptions } from '../../local/controller/types.js';
import type { TranscriptSources } from '../../monitor/history.js';
import type { AnalyticsPort } from '../../analytics/collector.js';
import type { RulesPort } from '../../rules/service.js';
import type { SessionModelPort } from '../../domain/ports/session-names.js';
import { startLocalServer } from '../../local/server/server.js';

type RuntimeConfiguration = Awaited<ReturnType<typeof runtimeConfiguration>>;

type LocalSurfaceDeps = Pick<
  LocalControllerOptions,
  'monitor' | 'store' | 'adapters' | 'dispatcher' | 'names' | 'removal'
> & {
  models?: SessionModelPort | undefined;
  config: RuntimeConfiguration;
  stateDirectory: string;
  localServices: LocalServices;
  readers: TranscriptSources;
  analytics: AnalyticsPort | undefined;
  rules: RulesPort | undefined;
};

export async function startLocalSurface(deps: LocalSurfaceDeps) {
  const { config, localServices, readers, stateDirectory } = deps;

  const localController = new LocalController({
    ...localServices,
    deviceId: config.deviceId,
    ownerId: config.ownerId,
    monitor: deps.monitor,
    store: deps.store,
    adapters: deps.adapters,
    dispatcher: deps.dispatcher,
    ...(deps.names ? { names: deps.names } : {}),
    ...(deps.removal ? { removal: deps.removal } : {}),
    ...(deps.models ? { models: deps.models } : {}),
    analytics: deps.analytics,
    rules: deps.rules,
    history: (request) => {
      if (request.agentId && deps.monitor.hasSubagentHistory(request.sessionId, request.generation)) {
        return deps.monitor.readSubagentHistory(request);
      }

      return readers.has(request.sessionId) ? readers.page(request) : Promise.resolve(null);
    },
    hasHistoryReader: (sessionId) => readers.has(sessionId),
  });

  const localServer = await startLocalServer({
    path: join(stateDirectory, 'client.sock'),
    capability: await localClientSecret(stateDirectory),
    controller: localController,
    grants: localServices.grants,
    instanceId: config.instanceId,
    refreshOrigins: async () => (await browserSettings(stateDirectory))?.origins ?? [],
  });

  return { localController, localServer };
}
