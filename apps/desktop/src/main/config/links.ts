export const DESKTOP_ASSET_URL = 'agent-remote://bundle/desktop.html';
export const DESKTOP_ASSET_PROTOCOL = 'agent-remote:';
export const DESKTOP_ASSET_HOST = 'bundle';
export const DESKTOP_ASSET_ENTRY = '/desktop.html';

export function isTrustedDesktopUrl(rawUrl: string): boolean {
  return rawUrl === DESKTOP_ASSET_URL;
}
