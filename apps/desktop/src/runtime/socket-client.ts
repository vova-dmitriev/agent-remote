import { connect as openSocket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  ErrorCode,
  LOCAL_LIMITS,
  LocalKind,
  LocalOrigin,
  localEventSchema,
  localGrantSchema,
  localHelloSchema,
  localRequestSchema,
  localResultSchema,
  type LocalAction,
  type ServerFrame,
} from '@protocol';
import { FramedPeer } from '../../../daemon/src/browser/transport/peer.js';

export interface DesktopSocketClient {
  request(action: LocalAction, signal?: AbortSignal): Promise<unknown>;
  subscribe(listener: (frame: ServerFrame) => void): () => void;
  close(): Promise<void>;
}

export async function connectDesktopSocket(
  path: string,
  capability: string,
  clientId: string,
  handle?: string,
): Promise<{ client: DesktopSocketClient; handle: string }> {
  const socket = openSocket(path);
  const connectFailure = once(socket, 'error').then(([error]) => Promise.reject(error));

  await Promise.race([once(socket, 'connect'), connectFailure]);
  let grantLease = '';
  let resolveGrant!: (handle: string) => void;
  let rejectGrant!: (error: Error) => void;

  const grant = new Promise<string>((resolve, reject) => {
    resolveGrant = resolve;
    rejectGrant = reject;
  });

  const helloId = randomUUID();

  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      signal?: AbortSignal;
      abort?: () => void;
    }
  >();

  const listeners = new Set<(frame: ServerFrame) => void>();
  let latestFrame: ServerFrame | undefined;

  const peer = new FramedPeer(socket, socket, (raw) => {
    if (raw && typeof raw === 'object' && 'kind' in raw && raw.kind === LocalKind.Result) {
      const result = localResultSchema.safeParse(raw);

      if (!result.success) {
        peer.close();

        return;
      }

      if (result.data.requestId === helloId) {
        if (!result.data.ok) {
          rejectGrant(new Error(result.data.code));
        } else {
          const value = localGrantSchema.safeParse(result.data.data);

          if (!value.success) {
            rejectGrant(new Error(ErrorCode.INVALID_FRAME));
          } else {
            grantLease = value.data.lease;
            resolveGrant(value.data.handle);
          }
        }

        return;
      }

      const request = pending.get(result.data.requestId);

      if (request) {
        pending.delete(result.data.requestId);

        if (request.abort && request.signal) {
          request.signal.removeEventListener('abort', request.abort);
        }

        if (result.data.ok) {
          request.resolve(result.data.data);
        } else {
          request.reject(new Error(result.data.code));
        }
      }

      return;
    }

    const event = localEventSchema.safeParse(raw);

    if (!event.success || (grantLease && event.data.lease !== grantLease)) {
      peer.close();

      return;
    }

    latestFrame = event.data.frame;
    listeners.forEach((listener) => listener(event.data.frame));
  });

  void peer.closed.then(() => {
    rejectGrant(new Error(ErrorCode.LOCAL_HOST_UNAVAILABLE));

    for (const request of pending.values()) {
      request.reject(new Error(ErrorCode.LOCAL_HOST_UNAVAILABLE));
    }

    pending.clear();
  });

  const hello = localHelloSchema.parse({
    kind: LocalKind.Hello,
    version: LOCAL_LIMITS.protocolVersion,
    requestId: helloId,
    clientId,
    ...(handle ? { handle } : {}),
  });

  await peer.send({ capability, origin: LocalOrigin.Desktop, hello });

  const responseHandle = await Promise.race([
    grant,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(ErrorCode.LOCAL_COMPANION_TIMEOUT)), LOCAL_LIMITS.requestTimeoutMs),
    ),
  ]);

  return {
    handle: responseHandle,
    client: {
      async request(action, signal) {
        if (signal?.aborted) {
          throw new Error(ErrorCode.STALE_EPOCH);
        }

        const requestId = randomUUID();

        const request = localRequestSchema.parse({
          kind: LocalKind.Request,
          version: LOCAL_LIMITS.protocolVersion,
          requestId,
          lease: grantLease,
          action,
        });

        const response = new Promise<unknown>((resolve, reject) => {
          const abort = () => {
            pending.delete(requestId);
            reject(new Error(ErrorCode.STALE_EPOCH));
          };

          if (signal) {
            signal.addEventListener('abort', abort, { once: true });
            pending.set(requestId, { resolve, reject, signal, abort });
          } else {
            pending.set(requestId, { resolve, reject });
          }
        });

        await peer.send(request);

        return response;
      },
      subscribe(listener) {
        listeners.add(listener);

        if (latestFrame) {
          listener(latestFrame);
        }

        return () => listeners.delete(listener);
      },
      async close() {
        peer.close();
        await peer.closed;
      },
    },
  };
}
