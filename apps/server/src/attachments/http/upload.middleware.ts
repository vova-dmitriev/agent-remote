import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { ErrorCode, MAX_ATTACHMENT_BYTES } from '@protocol';
import type { NextFunction, Request, Response } from 'express';
import { RELAY_CONFIG, type RelayConfig } from '../../app/relay-config.js';
import { Limiter, RateLimitKey } from '../../auth/security.js';
import { rawAttachmentParser } from '../../http/pipeline/body-parsers.js';
import { Fault } from '../../http/errors/fault.js';
import { AttachmentFaultCode } from '../errors.js';
import {
  ATTACHMENT_MAX_ACTIVE_UPLOADS,
  ATTACHMENT_UPLOAD_TIMEOUT_MS,
  ATTACHMENT_UPLOADS_PER_WINDOW,
} from '../limits.js';
import { AttachmentAccess } from './access.js';
import { replyAttachmentFault } from './attachment-fault.filter.js';

const IDENTITY_ENCODING = 'identity';
const BODY_TOO_LARGE = 'entity.too.large';

const isBodyTooLarge = (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'type' in error && error.type === BODY_TOO_LARGE);

/**
 * Authorizes an upload before its body is read, admits it within the rate, size and concurrency limits,
 * then reads the body as raw bytes whatever its Content-Type. Answers its own errors: it runs before the
 * controller's filter.
 */
@Injectable()
export class AttachmentUploadMiddleware implements NestMiddleware {
  private active = 0;
  private readonly parse = rawAttachmentParser();

  constructor(
    @Inject(AttachmentAccess) private readonly access: AttachmentAccess,
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(Limiter) private readonly limiter: Limiter,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    void this.access
      .authorize(req)
      .then(() => this.admit(req, res, next))
      .catch((error) => replyAttachmentFault(res, error));
  }

  private admit(req: Request, res: Response, next: NextFunction) {
    try {
      const { context, deviceMode } = this.access.scope(req);

      if (!deviceMode && !this.config.inputEnabled) {
        throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      this.limiter.take(RateLimitKey.Attachment + context.ownerId, ATTACHMENT_UPLOADS_PER_WINDOW);

      if (Number(req.headers['content-length']) > MAX_ATTACHMENT_BYTES) {
        throw new Fault(AttachmentFaultCode.TooLarge);
      }

      if (req.headers['content-encoding'] && req.headers['content-encoding'] !== IDENTITY_ENCODING) {
        throw new Fault(AttachmentFaultCode.Invalid);
      }

      if (this.active >= ATTACHMENT_MAX_ACTIVE_UPLOADS) {
        throw new Fault(AttachmentFaultCode.UploadBusy);
      }
    } catch (error) {
      replyAttachmentFault(res, error);

      return;
    }

    this.active++;
    let released = false;

    const release = () => {
      if (!released) {
        this.active--;
        released = true;
      }
    };

    res.once('finish', release);
    res.once('close', release);

    req.setTimeout(ATTACHMENT_UPLOAD_TIMEOUT_MS, () => {
      replyAttachmentFault(res, new Fault(AttachmentFaultCode.UploadTimeout));
      req.destroy();
    });

    this.parse(req, res, (error?: unknown) => {
      if (error) {
        replyAttachmentFault(
          res,
          new Fault(isBodyTooLarge(error) ? AttachmentFaultCode.TooLarge : AttachmentFaultCode.Invalid),
        );

        return;
      }

      next();
    });
  }
}
