import { ErrorCode, profileRequestSchema, ProfileRequestKind } from '@protocol';
import { HttpMethod } from './domain/http.js';
import { SourceHistory } from './history/source.js';
import { ProfileProxy } from './profiles/proxy.js';
import { ServerProfiles } from './profiles/service.js';
import { ProfileMetadataCache } from './profiles/repository.js';
import { AttachmentService } from './attachments/service.js';
import { mountAttachmentRoutes } from './attachments/routes.js';
import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import { type Database } from './db/database.js';
import { type AuthService } from './auth/auth-service.js';
import { type DeviceService } from './devices/service.js';
import { type Limiter, hash } from './auth/security.js';
import { Fault, toFault } from './http/errors/fault.js';
import { bearer } from './http/auth/bearer.js';
import { type RelayConfig } from './app/relay-config.js';
import { type CommandDispatcher } from './commands/command-dispatcher.js';
import { ContinuityService } from './continuity/service.js';
import { ContinuityProxy } from './continuity/proxy.js';
import { mountContinuityRoutes } from './continuity/routes.js';
import { type RelayHub } from './realtime/relay-hub.js';

export interface RelayRuntimeDependencies {
  config: RelayConfig;
  db: Database;
  auth: AuthService;
  devices: DeviceService;
  limiter: Limiter;
  hub: RelayHub;
  attachments: AttachmentService;
  continuity: ContinuityService;
  sourceHistory: SourceHistory;
  profileProxy: ProfileProxy;
  continuityProxy: ContinuityProxy;
  dispatcher: CommandDispatcher;
}

export type RelayRuntime = ReturnType<typeof createRelayRuntime>;

export const RELAY_RUNTIME = Symbol('RELAY_RUNTIME');
const boundedId = z.string().min(1).max(512);

/**
 * The attachment, continuity and profile routes that have not moved into Nest controllers yet.
 * Its `routes` router is mounted by `RelayModule` after the controllers and before the static files.
 */
export function createRelayRuntime({
  config,
  db,
  auth,
  devices,
  limiter,
  hub,
  attachments,
  continuity,
  sourceHistory,
  profileProxy,
  continuityProxy,
  dispatcher,
}: RelayRuntimeDependencies) {
  const http: Router = express.Router();
  const { dispatchHandoffCreate } = dispatcher;
  const profiles = new ServerProfiles(devices, hub.live, profileProxy, new ProfileMetadataCache(db));

  mountAttachmentRoutes(
    http,
    db,
    auth,
    devices,
    attachments,
    Boolean(config.inputEnabled),
    async (context, source) => {
      const page = await sourceHistory.page(
        { userId: context.ownerId },
        context.sessionId,
        undefined,
        source.messageId,
        undefined,
        source.position,
        true,
      );

      if (!page) {
        throw new Fault(ErrorCode.ATTACHMENT_UNAVAILABLE);
      }
    },
  );

  const route = (
    method: HttpMethod,
    path: string,
    handler: (req: Request, res: Response) => Promise<unknown>,
  ) =>
    http[method](path, (req, res, next) => {
      Promise.resolve(handler(req, res))
        .then(
          (value) => {
            if (!res.headersSent) {
              res.json(value ?? {});
            }
          },
          (error) => {
            const f = toFault(error);

            if (!res.headersSent) {
              res.status(f.status).json({ code: f.code });
            }
          },
        )
        .catch(next);
    });

  const principal = async (req: Request) => auth.authenticate(bearer(req));

  mountContinuityRoutes(
    route,
    principal,
    async (req) => {
      await auth.authenticate(bearer(req));
    },
    devices,
    continuity,
    continuityProxy,
    dispatchHandoffCreate,
  );

  route(HttpMethod.Post, '/devices/:deviceId/profiles', async (req, res) => {
    const token = bearer(req);
    const p = await principal(req);
    const deviceId = boundedId.parse(req.params.deviceId);

    limiter.take('profiles:' + p.userId, 120);
    const request = profileRequestSchema.parse(req.body);

    if (
      !config.inputEnabled &&
      request.kind !== ProfileRequestKind.List &&
      request.kind !== ProfileRequestKind.Operation
    ) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    const controller = new AbortController();

    const cancel = () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    };

    res.once('close', cancel);

    try {
      return await profiles.request(
        p,
        deviceId,
        request,
        hash(token),
        async () => {
          await auth.authenticate(token);
        },
        controller.signal,
      );
    } finally {
      res.off('close', cancel);
    }
  });

  return { routes: http };
}
