import { ExtensionApiValue, ExtensionConfig } from '../config/values.js';
import type { ChromeApi, ChromePort } from '../config/chrome-api.js';

export function trustedViewer(viewer: ChromePort, api: ChromeApi) {
  try {
    const expected = new URL(api.runtime.getURL(ExtensionConfig.EntryPage));
    const sender = viewer.sender;
    const url = new URL(sender?.url ?? '');

    return (
      viewer.name === ExtensionConfig.ViewerPortName &&
      sender?.id === api.runtime.id &&
      (sender.frameId === undefined || sender.frameId === 0) &&
      url.protocol === expected.protocol &&
      url.host === expected.host &&
      url.pathname === expected.pathname &&
      (sender.origin === undefined || sender.origin === expected.protocol + '//' + expected.host) &&
      (sender.documentLifecycle === undefined ||
        sender.documentLifecycle === ExtensionApiValue.ActiveDocument)
    );
  } catch {
    return false;
  }
}
