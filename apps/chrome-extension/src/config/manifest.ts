import { ExtensionConfig } from './values.ts';

const ExtensionContentSecurityPolicy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'";

export const extensionManifest = {
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
  content_security_policy: { extension_pages: ExtensionContentSecurityPolicy },
} as const;
