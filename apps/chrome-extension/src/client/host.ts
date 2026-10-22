import { HostKind } from '@protocol';
import type { HostAdapter } from '@/shared/lib/host';
import { chromeApi } from '../config/chrome-api.js';
import { ExtensionConfig } from '../config/values.js';
import { ExtensionApplicationClient } from './application-client.js';
import { ExtensionConnection } from './connection.js';

export function createChromeHost(
  factory: () => ExtensionConnection = () => new ExtensionConnection(),
): HostAdapter {
  return {
    kind: HostKind.Chrome,
    capabilities: { pairDevice: false, revokeDevice: false, fullTab: true, linkClients: false },
    saveProviderFilter: (filter) => {
      void chromeApi().storage.local.set({ [ExtensionConfig.ProviderFilterKey]: filter });
    },
    createClient: (handlers) => new ExtensionApplicationClient(factory(), handlers),
    openFullTab: async () => {
      const chrome = chromeApi();

      await chrome.tabs.create({ url: chrome.runtime.getURL(ExtensionConfig.EntryPage) });
    },
  };
}
