import { appendFile } from 'node:fs/promises';
import { LocalOperation } from '@protocol';
import { startDesktopMain } from '../../apps/desktop/src/main/bootstrap.js';
import { createDesktopCompanionConnector } from '../../apps/desktop/src/runtime/connector.js';
import type { DesktopCompanionFactory } from '../../apps/desktop/src/main/companion-port.js';

const {
  DESKTOP_FIXTURE_ASSET_ROOT: assetRoot,
  DESKTOP_FIXTURE_PRELOAD_PATH: preloadPath,
  DESKTOP_FIXTURE_RESOURCE_ROOT: resourceRoot,
  DESKTOP_FIXTURE_USER_DATA: userDataRoot,
  DESKTOP_FIXTURE_CONFIRM_LOG: confirmationLog,
  DESKTOP_FIXTURE_PROOF_LOG: proofLog,
  DESKTOP_FIXTURE_ERROR_LOG: errorLog,
  DESKTOP_FIXTURE_EXTERNAL_LOG: externalLog,
} = process.env;

if (
  !assetRoot ||
  !preloadPath ||
  !resourceRoot ||
  !userDataRoot ||
  !confirmationLog ||
  !proofLog ||
  !errorLog ||
  !externalLog
) {
  throw new Error('FIXTURE_RESOURCES_REQUIRED');
}

const companionFactory: DesktopCompanionFactory = async (options) => {
  try {
    const connector = await createDesktopCompanionConnector({
      ...options,
      verifiedResourceRoot: resourceRoot,
      privateUserDataRoot: userDataRoot,
      appVersion: '0.1.0',
      confirmLocalAccess: async () => {
        await appendFile(confirmationLog, 'confirmed\n', { mode: 0o600 });

        return true;
      },
    });

    const devices = await connector.request({ operation: LocalOperation.Devices });

    if (!Array.isArray(devices)) {
      throw new Error('DESKTOP_COMPANION_REQUEST_FAILED');
    }

    await appendFile(proofLog, `${devices.length}\n`, { mode: 0o600 });

    return connector;
  } catch (error) {
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);

    await appendFile(errorLog, `${detail}\n`, { mode: 0o600 });
    throw error;
  }
};

void startDesktopMain({
  companionFactory,
  assetRoot,
  preloadPath,
  openExternal: async (url) => appendFile(externalLog, `${url}\n`, { mode: 0o600 }),
});
