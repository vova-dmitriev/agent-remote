import { localHelloSchema, type LocalClientGrant } from '../../../../packages/protocol/src/index.js';
import { ExtensionApiValue, ExtensionConfig } from '../config/values.js';
import type { ChromeApi } from '../config/chrome-api.js';

interface Identity {
  clientId: string;
  handle?: string;
}

class WorkerIdentity {
  private initialized: Promise<Identity>;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private api: ChromeApi) {
    this.initialized = this.load();
  }

  private async load(): Promise<Identity> {
    await this.api.storage.local.setAccessLevel({ accessLevel: ExtensionApiValue.TrustedContexts });
    const saved = await this.api.storage.local.get([ExtensionConfig.ClientIdKey, ExtensionConfig.HandleKey]);
    const parsed = localHelloSchema.shape.clientId.safeParse(saved[ExtensionConfig.ClientIdKey]);
    const clientId = parsed.success ? parsed.data : crypto.randomUUID();
    const handle = localHelloSchema.shape.handle.safeParse(saved[ExtensionConfig.HandleKey]);

    await this.api.storage.local.set({ [ExtensionConfig.ClientIdKey]: clientId });

    return { clientId, ...(handle.success && handle.data ? { handle: handle.data } : {}) };
  }

  run(perform: (identity: Identity) => Promise<LocalClientGrant>) {
    const result = this.tail.then(async () => {
      const identity = await this.initialized;
      const grant = await perform(identity);

      await this.api.storage.local.set({ [ExtensionConfig.HandleKey]: grant.handle });
      identity.handle = grant.handle;

      return grant;
    });

    this.tail = result.catch(() => {});

    return result;
  }
}

const identities = new WeakMap<ChromeApi, WorkerIdentity>();

export function workerIdentity(api: ChromeApi) {
  let identity = identities.get(api);

  if (!identity) {
    identity = new WorkerIdentity(api);
    identities.set(api, identity);
  }

  return identity;
}
