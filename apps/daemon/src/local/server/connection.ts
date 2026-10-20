import type { Socket } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  ErrorCode,
  LOCAL_LIMITS,
  LocalFeature,
  LocalKind,
  LocalOperation,
  localHelloSchema,
  localRequestSchema,
  LocalControl,
} from '@protocol';
import { FramedPeer } from '../../browser/transport/peer.js';
import type { LocalPrincipal } from '../grants/types.js';
import type { LocalServerOptions } from './types.js';

const handshake = z.strictObject({
  capability: z.string().min(1).max(128),
  origin: z.string().max(128),
  hello: localHelloSchema,
});

const health = z.strictObject({
  capability: z.string().min(1).max(128),
  control: z.literal(LocalControl.Health),
  featureRequest: z.literal(LocalFeature.DesktopGrants).optional(),
});

const digest = (value: string) => createHash('sha256').update(value).digest();

const safeCode = (error: unknown) =>
  error instanceof Error && Object.values(ErrorCode).includes(error.message as ErrorCode)
    ? error.message
    : ErrorCode.INVALID_REQUEST;

export function acceptLocalPeer(socket: Socket, options: LocalServerOptions) {
  let principal: LocalPrincipal | undefined;
  let selected: string | null = null;
  let unsubscribe: (() => void) | undefined;
  const lifetime = new AbortController();
  const timer = setTimeout(() => socket.destroy(), LOCAL_LIMITS.requestTimeoutMs);

  const peer = new FramedPeer(
    socket,
    socket,
    async (raw) => {
      if (!principal) {
        const probe = health.safeParse(raw);

        if (probe.success && timingSafeEqual(digest(probe.data.capability), digest(options.capability))) {
          await peer.send({
            protocolVersion: LOCAL_LIMITS.protocolVersion,
            instanceId: options.instanceId ?? options.path,
            // Which build answers: a desktop app replaces a companion started from another runtime.
            pid: process.pid,
            entry: process.argv[1] ?? '',
            ...(probe.data.featureRequest ? { features: [LocalFeature.DesktopGrants] } : {}),
          });

          peer.close();

          return;
        }

        const parsed = handshake.safeParse(raw);

        if (!parsed.success || !timingSafeEqual(digest(parsed.data.capability), digest(options.capability))) {
          peer.close();

          return;
        }

        const { hello, origin } = parsed.data;

        try {
          if (options.refreshOrigins) {
            options.grants.replaceOrigins(await options.refreshOrigins());
          }

          principal = options.grants.connect(origin, hello.clientId, hello.handle);

          await peer.send({
            kind: LocalKind.Result,
            requestId: hello.requestId,
            ok: true,
            data: {
              lease: principal.lease,
              handle: principal.handle,
              ownerId: principal.ownerId,
              deviceId: principal.deviceId,
            },
          });

          clearTimeout(timer);

          unsubscribe = options.controller.subscribe(
            principal,
            (frame) => {
              void peer
                .send({ kind: LocalKind.Event, lease: principal!.lease, frame })
                .catch(() => peer.close());
            },
            () => selected,
          );

          await peer.send({
            kind: LocalKind.Event,
            lease: principal.lease,
            frame: options.controller.snapshot(principal),
          });
        } catch (error) {
          await peer.send({
            kind: LocalKind.Result,
            requestId: hello.requestId,
            ok: false,
            code: safeCode(error),
          });

          peer.close();
        }

        return;
      }

      const parsed = localRequestSchema.safeParse(raw);

      if (!parsed.success || parsed.data.lease !== principal.lease) {
        peer.close();

        return;
      }

      const request = parsed.data;

      try {
        const data = await options.controller.execute(principal, request.action, lifetime.signal);

        if (request.action.operation === LocalOperation.Select) {
          selected = request.action.sessionId;
        }

        await peer.send({ kind: LocalKind.Result, requestId: request.requestId, ok: true, data });

        if (request.action.operation === LocalOperation.Select) {
          await peer.send({
            kind: LocalKind.Event,
            lease: principal.lease,
            frame: options.controller.snapshot(principal, selected),
          });
        }

        if (request.action.operation === LocalOperation.Logout) {
          peer.close();
        }
      } catch (error) {
        await peer.send({
          kind: LocalKind.Result,
          requestId: request.requestId,
          ok: false,
          code: safeCode(error),
        });

        if (!options.grants.current(principal)) {
          peer.close();
        }
      }
    },
    (raw) => {
      const request = localRequestSchema.safeParse(raw);

      if (
        principal &&
        request.success &&
        request.data.lease === principal.lease &&
        request.data.action.operation === LocalOperation.Logout
      ) {
        lifetime.abort();
      }
    },
  );

  void peer.closed.then(() => {
    lifetime.abort();
    clearTimeout(timer);
    unsubscribe?.();
  });
}
