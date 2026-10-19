import {
  ErrorCode,
  FrameType,
  LOCAL_LIMITS,
  LocalKind,
  localHelloSchema,
  localRequestSchema,
  localGrantSchema,
  type LocalClientGrant,
} from '@protocol';
import { fragmentValue } from '@transport/native/fragments.js';
import { ExtensionConfig } from '../config/values.js';
import type { ChromeApi, ChromePort } from '../config/chrome-api.js';
import { workerIdentity } from './identity.js';
import { BrokerPending } from './pending.js';
import { NativeReader } from './native/reader.js';
import { trustedViewer } from './sender.js';

export function attachViewer(viewer: ChromePort, api: ChromeApi, onClosed = () => {}): () => void {
  let native: ChromePort | undefined;
  let stopped = false;
  let lease = '';
  let helloId = '';
  let handshake: Promise<void> = Promise.resolve();
  let incoming = Promise.resolve();
  let buffered = 0;
  let resolveHello: ((grant: LocalClientGrant) => void) | undefined;
  let rejectHello: ((error: Error) => void) | undefined;

  const pending = new BrokerPending((id) => {
    viewer.postMessage({ kind: LocalKind.Result, requestId: id, ok: false, code: ErrorCode.REQUEST_TIMEOUT });

    if (id === helloId && !lease) {
      close();
    }
  });

  const reader = new NativeReader(pending, {
    current: () => !stopped,
    lease: () => lease,
    helloId: () => helloId,
    hello: async (result) => {
      if (result.ok) {
        resolveHello?.(localGrantSchema.parse(result.data));
      } else {
        rejectHello?.(new Error(result.code));
      }

      await handshake;
    },
    send: (value) => viewer.postMessage(value),
  });

  const close = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    rejectHello?.(new Error(ErrorCode.IPC_CLOSED));
    reader.clear();
    pending.clear();
    native?.disconnect();
    viewer.disconnect();
    onClosed();
  };

  if (!trustedViewer(viewer, api)) {
    close();

    return close;
  }

  const unavailable = () => {
    if (stopped) {
      return;
    }

    void api.runtime.lastError;

    if (helloId && !lease) {
      viewer.postMessage({
        kind: LocalKind.Result,
        requestId: helloId,
        ok: false,
        code: ErrorCode.LOCAL_HOST_UNAVAILABLE,
      });
    } else if (lease) {
      viewer.postMessage({
        kind: LocalKind.Event,
        lease,
        frame: { type: FrameType.Error, code: ErrorCode.LOCAL_HOST_UNAVAILABLE },
      });
    }

    close();
  };

  viewer.onMessage.addListener((raw) => {
    if (stopped) {
      return;
    }

    try {
      if (!helloId) {
        const hello = localHelloSchema.parse(raw);

        helloId = hello.requestId;
        pending.add(helloId);

        handshake = workerIdentity(api)
          .run((identity) => {
            if (stopped) {
              throw new Error(ErrorCode.IPC_CLOSED);
            }

            native = api.runtime.connectNative(ExtensionConfig.NativeHostName);
            native.onDisconnect.addListener(unavailable);

            native.onMessage.addListener((message) => {
              if (++buffered > LOCAL_LIMITS.maxPendingRequests) {
                close();

                return;
              }

              incoming = incoming
                .then(() => reader.accept(message))
                .catch(close)
                .finally(() => {
                  --buffered;
                });
            });

            return new Promise<LocalClientGrant>((resolve, reject) => {
              resolveHello = resolve;
              rejectHello = reject;

              for (const piece of fragmentValue(
                { kind: LocalKind.Hello, version: hello.version, requestId: helloId, ...identity },
                crypto.randomUUID(),
              )) {
                native!.postMessage(piece);
              }
            });
          })
          .then((grant) => {
            if (stopped) {
              return;
            }

            lease = grant.lease;
            viewer.postMessage({ kind: LocalKind.Result, requestId: helloId, ok: true, data: grant });
          })
          .catch((error: unknown) => {
            if (stopped) {
              return;
            }

            viewer.postMessage({
              kind: LocalKind.Result,
              requestId: helloId,
              ok: false,
              code: error instanceof Error ? error.message : ErrorCode.LOCAL_HOST_UNAVAILABLE,
            });

            close();
          });

        return;
      }

      const value = localRequestSchema.parse(raw);

      if (!lease || value.lease !== lease) {
        throw new Error(ErrorCode.UNAUTHORIZED);
      }

      pending.add(value.requestId);

      for (const piece of fragmentValue(value, crypto.randomUUID())) {
        native!.postMessage(piece);
      }
    } catch {
      unavailable();
    }
  });

  viewer.onDisconnect.addListener(close);

  return close;
}
