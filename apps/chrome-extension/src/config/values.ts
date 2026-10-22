// Loaded by Node while Vite reads vite.extension.config.ts, before any alias exists.
// eslint-disable-next-line no-restricted-imports
import { NATIVE_HOST_NAME } from '../../../../packages/protocol/src/local/local-limits.js';

export const ExtensionApiValue = {
  TrustedContexts: 'TRUSTED_CONTEXTS',
  ActiveDocument: 'active',
} as const;

export const ExtensionConfig = {
  NativeHostName: NATIVE_HOST_NAME,
  ViewerPortName: 'agent-remote-viewer',
  ClientIdKey: 'agentRemoteClientId',
  HandleKey: 'agentRemoteClientHandle',
  LanguageKey: 'agentRemoteLanguage',
  ProviderFilterKey: 'agentRemoteProviderFilter',
  /** The refresh credential a code linked this extension with, to its build's server. */
  LinkKey: 'agentRemoteLink',
  /** Set once the owner chose this Mac's companion over linking to the server. */
  CompanionKey: 'agentRemoteCompanion',
  /** The build-time variable naming the server the extension links to; unset builds use only the Mac companion. */
  ServerOriginVariable: 'VITE_EXTENSION_SERVER_ORIGIN',
  EntryPage: 'extension.html',
  BackgroundFile: 'background.js',
  MinimumChromeVersion: '116',
} as const;
