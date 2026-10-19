export const DESKTOP_ASSET_URL = 'agent-remote://bundle/desktop.html';
export const DESKTOP_ASSET_PROTOCOL = 'agent-remote:';
export const DESKTOP_ASSET_HOST = 'bundle';
export const DESKTOP_ASSET_ENTRY = '/desktop.html';

const FRAGMENT_MARKER = '#';
const assetUrl = new URL(DESKTOP_ASSET_URL);

function parse(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

/**
 * The bundle document, whatever its fragment: the renderer keeps in-app routes (`#/sessions/…`) in the hash.
 * Everything before the fragment must be the exact asset URL string, so parser normalisation
 * (empty credentials, empty or explicit ports, backslashes, dot segments, percent-encoding) never widens trust.
 */
export function isTrustedDesktopUrl(rawUrl: string): boolean {
  const fragment = rawUrl.indexOf(FRAGMENT_MARKER);
  const document = fragment === -1 ? rawUrl : rawUrl.slice(0, fragment);
  const url = parse(rawUrl);

  return (
    document === DESKTOP_ASSET_URL &&
    url !== null &&
    url.protocol === assetUrl.protocol &&
    url.host === assetUrl.host &&
    url.pathname === assetUrl.pathname &&
    url.search === assetUrl.search &&
    url.username === '' &&
    url.password === ''
  );
}
