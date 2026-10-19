import { LOCAL_LIMITS } from '@protocol';
import type { ChromeApi, ChromePort } from '../config/chrome-api.js';
import { attachViewer } from './broker.js';
import { trustedViewer } from './sender.js';

export class ViewerRegistry {
  private viewers = new Set<ChromePort>();

  constructor(private api: ChromeApi) {}

  attach(port: ChromePort) {
    if (!trustedViewer(port, this.api) || this.viewers.size >= LOCAL_LIMITS.maxClients) {
      port.disconnect();

      return;
    }

    this.viewers.add(port);

    attachViewer(port, this.api, () => {
      this.viewers.delete(port);
    });
  }
}
