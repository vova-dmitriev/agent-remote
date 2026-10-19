// Loaded by Node while Vite reads vite.extension.config.ts, before any alias exists.
// eslint-disable-next-line no-restricted-imports
import { NATIVE_HOST_NAME } from '../../../../packages/protocol/src/local-limits.js';

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
  EntryPage: 'extension.html',
  BackgroundFile: 'background.js',
  MinimumChromeVersion: '116',
} as const;
