import { ExtensionConfig } from './values.ts';

/** Pages may connect to the extension itself and, in a linked build, to its one server over HTTPS and WSS. */
const contentSecurityPolicy = (server?: string) =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'${server ? ` ${server} ${server.replace('https:', 'wss:')}` : ''}; img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'`;

/** The server a linked build talks to: an HTTPS origin and nothing more. */
export function serverOrigin(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const url = new URL(value);

  if (url.protocol !== 'https:' || url.origin !== value) {
    throw new Error('VITE_EXTENSION_SERVER_ORIGIN must be an https origin');
  }

  return value;
}

export const extensionManifestFor = (server?: string) => ({
  manifest_version: 3,
  name: 'Agent Remote',
  version: '0.1.0',
  description: 'Use the shared Agent Remote interface with your approved local companion.',
  minimum_chrome_version: ExtensionConfig.MinimumChromeVersion,
  permissions: ['sidePanel', 'nativeMessaging', 'storage'],
  incognito: 'not_allowed',
  action: { default_title: 'Agent Remote' },
  side_panel: { default_path: ExtensionConfig.EntryPage },
  background: { service_worker: ExtensionConfig.BackgroundFile, type: 'module' },
  content_security_policy: { extension_pages: contentSecurityPolicy(server) },
});
