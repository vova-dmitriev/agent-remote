import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { DesktopBridgeError } from '../../../../packages/protocol/src/index.js';
import type { DesktopCompanionFactory } from './companion-port.js';
import { installDesktopIpc, type DesktopIpcController } from './ipc.js';
import { registerDesktopAssetScheme, registerDesktopAssets } from './protocol.js';
import { createDesktopWindow } from './window.js';

registerDesktopAssetScheme();

export interface DesktopBootstrapOptions {
  companionFactory: DesktopCompanionFactory;
  assetRoot: string;
  preloadPath: string;
  openExternal?: (url: string) => Promise<void>;
}

export async function startDesktopMain(options: DesktopBootstrapOptions): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();

    return;
  }

  await app.whenReady();

  let window: BrowserWindow | null = null;
  let bridge: DesktopIpcController | null = null;
  let connector: Awaited<ReturnType<DesktopCompanionFactory>>;

  try {
    connector = await options.companionFactory({
      verifiedResourceRoot: process.resourcesPath,
      privateUserDataRoot: app.getPath('userData'),
      platform: process.platform,
      architecture: process.arch,
      appVersion: app.getVersion(),
      confirmLocalAccess: async () => {
        const result = await dialog.showMessageBox({
          type: 'warning',
          title: 'Allow local companion access?',
          message: 'Allow Agent Remote to access sessions on this computer?',
          detail: 'This permission is kept by the local companion and can be revoked in its access settings.',
          buttons: ['Allow', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });

        return result.response === 0;
      },
    });
  } catch {
    app.quit();
    throw new Error(DesktopBridgeError.Unavailable);
  }

  await registerDesktopAssets(options.assetRoot);

  window = createDesktopWindow({ preloadPath: options.preloadPath });

  bridge = installDesktopIpc(
    {
      handle: (channel, handler) =>
        ipcMain.handle(channel, (event, payload) =>
          handler(
            {
              sender: event.sender as never,
              senderFrame: event.senderFrame as never,
            },
            payload,
          ),
        ),
      removeHandler: (channel) => ipcMain.removeHandler(channel),
    },
    () => window,
    connector,
    options.openExternal,
  );

  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) {
      return;
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window.focus();
  });

  window.on('closed', () => {
    bridge?.revoke();
    window = null;
  });

  app.on('before-quit', () => {
    bridge?.dispose();
    void connector.close();
  });
}
