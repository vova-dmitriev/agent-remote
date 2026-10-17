import { AttachmentKind, MAX_ATTACHMENT_BYTES } from '../../../../packages/protocol/src/index.js';
import {
  ATTACHMENT_UPLOADS_PER_WINDOW,
  ATTACHMENT_MAX_ACTIVE_UPLOADS,
  ATTACHMENT_UPLOAD_TIMEOUT_MS,
} from './limits.js';
import { AttachmentFaultCode } from './errors.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { type Database } from '../db/database.js';
import { type AuthService } from '../auth/auth-service.js';
import { type DeviceService } from '../devices/service.js';
import { Fault, Limiter } from '../auth/security.js';
import { AttachmentService, type AttachmentContext } from './service.js';

const bearer = (req: Request) => {
  const value = req.headers.authorization;

  if (!value?.startsWith('Bearer ') || value.length > 520) {
    throw new Fault('UNAUTHORIZED', 401);
  }

  return value.slice(7);
};

const fail = (res: Response, error: unknown) => {
  let fault: Fault;

  if (error instanceof Fault) {
    fault = error;
  } else if (error instanceof z.ZodError || error instanceof URIError) {
    fault = new Fault(AttachmentFaultCode.Invalid);
  } else {
    fault = new Fault('INTERNAL_ERROR', 503);
  }

  if (!res.headersSent) {
    res.status(fault.status).json({ code: fault.code });
  }
};

export function mountAttachmentRoutes(
  http: express.Express,
  db: Database,
  auth: AuthService,
  devices: DeviceService,
  service: AttachmentService,
  inputEnabled: boolean,
  recover?: (context: AttachmentContext, source: { messageId: string; position: string }) => Promise<void>,
) {
  let active = 0;
  const limiter = new Limiter();

  for (const deviceMode of [false, true]) {
    const path = `${deviceMode ? '/device' : ''}/sessions/:sessionId/attachments`;
    const contexts = new WeakMap<Request, AttachmentContext>();

    const authorize = (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        const sessionId = String(req.params.sessionId);

        if (sessionId.length > 512) {
          throw new Fault('INVALID_REQUEST');
        }

        if (deviceMode) {
          const device = await devices.authenticate(bearer(req));

          contexts.set(req, { ownerId: device.owner_id, deviceId: device.id, sessionId });
        } else {
          const principal = await auth.authenticate(bearer(req));

          const row = (
            await db.pool.query<{ device_id: string }>(
              'SELECT s.device_id FROM sessions s JOIN devices d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL',
              [principal.userId, sessionId],
            )
          ).rows[0];

          if (!row) {
            throw new Fault('NOT_FOUND', 404);
          }

          contexts.set(req, { ownerId: principal.userId, deviceId: row.device_id, sessionId });
        }

        next();
      })().catch((error) => fail(res, error));
    };

    http.post(
      path,
      authorize,
      (req: Request, res: Response, next: NextFunction) => {
        try {
          if (!deviceMode && !inputEnabled) {
            throw new Fault('CAPABILITY_UNAVAILABLE', 409);
          }

          limiter.take(contexts.get(req)!.ownerId, ATTACHMENT_UPLOADS_PER_WINDOW);

          if (Number(req.headers['content-length']) > MAX_ATTACHMENT_BYTES) {
            throw new Fault(AttachmentFaultCode.TooLarge, 413);
          }

          if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
            throw new Fault(AttachmentFaultCode.Invalid);
          }

          if (active >= ATTACHMENT_MAX_ACTIVE_UPLOADS) {
            throw new Fault(AttachmentFaultCode.UploadBusy, 429);
          }

          active++;
          let released = false;

          const release = () => {
            if (!released) {
              active--;
              released = true;
            }
          };

          res.once('finish', release);
          res.once('close', release);

          req.setTimeout(ATTACHMENT_UPLOAD_TIMEOUT_MS, () => {
            fail(res, new Fault(AttachmentFaultCode.UploadTimeout, 408));
            req.destroy();
          });

          next();
        } catch (error) {
          fail(res, error);
        }
      },
      express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES, inflate: false }),
      (req: Request, res: Response) => {
        void (async () => {
          const context = contexts.get(req)!;

          if (deviceMode) {
            await devices.authenticate(bearer(req));
          } else {
            await auth.authenticate(bearer(req));
          }

          const result = await service.store(
            context,
            {
              uploadId: z.uuid().parse(req.headers['x-upload-id']),
              name: decodeURIComponent(z.string().max(2048).parse(req.headers['x-file-name'])),
              generation: z.string().min(1).max(512).parse(req.headers['x-session-generation']),
              mimeType: z.string().min(1).max(128).parse(req.headers['content-type']?.split(';')[0]),
              bytes: req.body as Buffer,
              ...(deviceMode && req.headers['x-source-position']
                ? {
                    source: {
                      messageId: z.string().min(1).max(512).parse(req.headers['x-source-message-id']),
                      position: z
                        .string()
                        .min(10)
                        .max(2048)
                        .startsWith('position:')
                        .parse(req.headers['x-source-position']),
                    },
                  }
                : {}),
            },
            deviceMode,
            () => res.setHeader('X-Attachment-Cache-Hit', '1'),
          );

          res.json(result);
        })().catch((error) => fail(res, error));
      },
      (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        fail(
          res,
          new Fault(
            error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large'
              ? AttachmentFaultCode.TooLarge
              : AttachmentFaultCode.Invalid,
            error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large'
              ? 413
              : 400,
          ),
        );
      },
    );

    http.head(path + '/:attachmentId', authorize, (req, res) => {
      void service
        .available(contexts.get(req)!, String(req.params.attachmentId))
        .then((available) => res.status(available ? 204 : 404).end())
        .catch((error) => fail(res, error));
    });

    http.get(path + '/:attachmentId', authorize, (req, res) => {
      void (async () => {
        const context = contexts.get(req)!,
          id = String(req.params.attachmentId);

        let result;

        try {
          result = await service.read(context, id);
        } catch (error) {
          if (!(error instanceof Fault) || error.code !== AttachmentFaultCode.RebuildRequired || !recover) {
            throw error;
          }

          await recover(context, await service.source(context, id));
          result = await service.read(context, id);
        }

        const { descriptor, bytes } = result;

        res.setHeader(
          'Content-Type',
          descriptor.kind === AttachmentKind.Image ? descriptor.mimeType : 'application/octet-stream',
        );

        res.setHeader(
          'Content-Disposition',
          `${descriptor.kind === AttachmentKind.Image ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(descriptor.name).replace(/[!'()*]/gu, (char) => '%' + char.charCodeAt(0).toString(16))}`,
        );

        res.setHeader('Content-Length', bytes.length);
        res.send(bytes);
      })().catch((error) => fail(res, error));
    });
  }
}
