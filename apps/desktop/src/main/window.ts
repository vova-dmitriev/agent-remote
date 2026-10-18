import { BrowserWindow, session } from 'electron';
import { DESKTOP_ASSET_URL, isTrustedDesktopUrl } from './config/links.js';

const WindowOpenAction = { Deny: 'deny' } as const;

type WindowOpenAction = (typeof WindowOpenAction)[keyof typeof WindowOpenAction];

export interface DesktopWindowOptions {
  preloadPath: string;
}

export function createDesktopWindow({ preloadPath }: DesktopWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });

  window.webContents.setWindowOpenHandler((): { action: WindowOpenAction } => ({
    action: WindowOpenAction.Deny,
  }));

  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedDesktopUrl(url)) {
      event.preventDefault();
    }
  });

  window.webContents.on('will-frame-navigate', (details) => {
    if (!details.isMainFrame || !isTrustedDesktopUrl(details.url)) {
      details.preventDefault();
    }
  });

  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  void window.loadURL(DESKTOP_ASSET_URL);

  window.once('ready-to-show', () => window.show());

  return window;
}
