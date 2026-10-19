import { join } from 'node:path';
import { browserSettings, type runtimeConfiguration } from '../../local/bootstrap/configuration.js';
import { localClientSecret } from '../../local/bootstrap/identity.js';
import type { LocalServices } from '../../local/bootstrap/services.js';
import { LocalController } from '../../local/controller/controller.js';
import type { LocalControllerOptions } from '../../local/controller/types.js';
import type { TranscriptSources } from '../../monitor/history.js';
import { startLocalServer } from '../../local/server/server.js';

type RuntimeConfiguration = Awaited<ReturnType<typeof runtimeConfiguration>>;

type LocalSurfaceDeps = Pick<LocalControllerOptions, 'monitor' | 'store' | 'adapters' | 'dispatcher'> & {
  config: RuntimeConfiguration;
  stateDirectory: string;
  localServices: LocalServices;
  readers: TranscriptSources;
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
    history: (request) => (readers.has(request.sessionId) ? readers.page(request) : Promise.resolve(null)),
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
