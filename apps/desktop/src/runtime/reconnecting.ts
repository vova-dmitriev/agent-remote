import { ErrorCode, LOCAL_LIMITS, type ServerFrame } from '@protocol';
import { ReconnectBackoff } from '@transport/reconnect-backoff.js';
import type { DesktopCompanionConnector } from '../main/companion-port.js';
import type { DesktopSocketClient } from './socket-client.js';

const COMPANION_RECONNECT = { BaseMs: 500, MaxMs: 15_000, StableMs: 30_000 } as const;

/**
 * Keeps the desktop on its companion: a dropped socket is opened again with backoff, subscribers move to the new
 * connection, and a request made meanwhile waits for it up to the request timeout.
 */
export async function reconnectingConnector(
  open: () => Promise<DesktopSocketClient>,
): Promise<DesktopCompanionConnector> {
  const listeners = new Set<(frame: ServerFrame) => void>();
  const backoff = new ReconnectBackoff(COMPANION_RECONNECT);
  let stopped = false;
  let current: DesktopSocketClient | null = null;
  let latest: ServerFrame | undefined;
  let ready: Promise<DesktopSocketClient>;

  const attach = (client: DesktopSocketClient) => {
    current = client;
    backoff.authenticated();

    client.subscribe((frame) => {
      latest = frame;
      listeners.forEach((listener) => listener(frame));
    });

    void client.closed.then(() => {
      if (current !== client || stopped) {
        return;
      }

      current = null;
      ready = retry();
      ready.catch(() => {});
    });

    return client;
  };

  const retry = async (): Promise<DesktopSocketClient> => {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, backoff.next()));

      if (stopped) {
        throw new Error(ErrorCode.LOCAL_HOST_UNAVAILABLE);
      }

      try {
        return attach(await open());
      } catch {
        // The companion is still starting or gone; the next attempt starts it again.
      }
    }
  };

  ready = Promise.resolve(attach(await open()));

  const connected = () =>
    current
      ? Promise.resolve(current)
      : Promise.race([
          ready,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () => reject(new Error(ErrorCode.LOCAL_HOST_UNAVAILABLE)),
              LOCAL_LIMITS.requestTimeoutMs,
            ),
          ),
        ]);

  return {
    request: async (action, signal) => (await connected()).request(action, signal),
    subscribe(listener) {
      listeners.add(listener);

      if (latest) {
        listener(latest);
      }

      return () => listeners.delete(listener);
    },
    async close() {
      stopped = true;
      await current?.close();
    },
  };
}
