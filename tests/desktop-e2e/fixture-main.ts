import { appendFile } from 'node:fs/promises';
import { startDesktopMain } from '@desktop/main/bootstrap.js';
import type { DesktopCompanionConnector } from '@desktop/main/companion-port.js';

const {
  DESKTOP_FIXTURE_ASSET_ROOT: assetRoot,
  DESKTOP_FIXTURE_PRELOAD_PATH: preloadPath,
  DESKTOP_FIXTURE_EXTERNAL_LOG: externalLog,
} = process.env;

if (!assetRoot || !preloadPath || !externalLog) {
  throw new Error('FIXTURE_RESOURCES_REQUIRED');
}

const connector: DesktopCompanionConnector = {
  request: async () => null,
  subscribe: () => () => {},
  close: async () => {},
};

void startDesktopMain({
  companionFactory: async () => connector,
  assetRoot,
  preloadPath,
  openExternal: async (url) => appendFile(externalLog, `${url}\n`, { mode: 0o600 }),
});
