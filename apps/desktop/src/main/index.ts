import { app, dialog } from 'electron';
import { join } from 'node:path';
import { createDesktopCompanionConnector } from '../runtime/connector.js';
import { startDesktopMain } from './bootstrap.js';

void startDesktopMain({
  companionFactory: createDesktopCompanionConnector,
  assetRoot: join(app.getAppPath(), 'dist', 'renderer'),
  preloadPath: join(app.getAppPath(), 'dist', 'preload', 'bridge.cjs'),
}).catch(async () => {
  await app.whenReady();

  dialog.showErrorBox(
    'Agent Remote is unavailable',
    'The verified local companion resources could not be opened.',
  );

  app.quit();
});
