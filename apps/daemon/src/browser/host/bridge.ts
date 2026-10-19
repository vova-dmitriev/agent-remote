import { connect } from 'node:net';
import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { ErrorCode, LocalKind, localHelloSchema, localRequestSchema, LOCAL_LIMITS } from '@protocol';
import { FramedPeer } from '../transport/peer.js';

export interface NativeHostOptions {
  path: string;
  capability: string;
  origin: string;
  beforeConnect?: () => Promise<void>;
}

export async function runNativeHost(io: { input: Readable; output: Writable }, options: NativeHostOptions) {
  let local: FramedPeer | undefined;
  let lease = '';
  let helloReceived = false;
  const timer = setTimeout(() => viewer.close(), LOCAL_LIMITS.requestTimeoutMs);

  const viewer = new FramedPeer(io.input, io.output, async (raw) => {
    if (!helloReceived) {
      const hello = localHelloSchema.safeParse(raw);

      if (!hello.success) {
        viewer.close();

        return;
      }

      helloReceived = true;

      try {
        await options.beforeConnect?.();
        const socket = connect(options.path);

        await once(socket, 'connect');

        local = new FramedPeer(socket, socket, async (message) => {
          if (
            message &&
            typeof message === 'object' &&
            'kind' in message &&
            message.kind === LocalKind.Result &&
            'ok' in message &&
            message.ok &&
            'data' in message
          ) {
            const data = message.data;

            if (data && typeof data === 'object' && 'lease' in data && typeof data.lease === 'string') {
              lease = data.lease;
            }
          }

          await viewer.send(message);
        });

        void local.closed.then(() => viewer.close());
        await local.send({ capability: options.capability, origin: options.origin, hello: hello.data });
        clearTimeout(timer);
      } catch (error) {
        const code =
          error instanceof Error && Object.values(ErrorCode).includes(error.message as ErrorCode)
            ? error.message
            : ErrorCode.LOCAL_HOST_UNAVAILABLE;

        await viewer.send({ kind: LocalKind.Result, requestId: hello.data.requestId, ok: false, code });
        viewer.close();
      }

      return;
    }

    const request = localRequestSchema.safeParse(raw);

    if (!request.success || !lease || request.data.lease !== lease || !local) {
      viewer.close();

      return;
    }

    await local.send(request.data);
  });

  await viewer.closed;
  clearTimeout(timer);
  local?.close();
}
