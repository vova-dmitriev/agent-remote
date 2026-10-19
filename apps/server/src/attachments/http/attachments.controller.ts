import {
  Controller,
  Get,
  Head,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AttachmentKind, ErrorCode, HttpStatus } from '@protocol';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { SourceHistory } from '../../history/source.js';
import { Fault } from '../../http/errors/fault.js';
import { AttachmentFaultCode } from '../errors.js';
import { AttachmentService, type AttachmentContext } from '../service.js';
import { AttachmentAccess, AttachmentGuard, AttachmentRoute } from './access.js';
import { AttachmentFaultFilter } from './attachment-fault.filter.js';

const OCTET_STREAM = 'application/octet-stream';

/**
 * Stores uploads that `AttachmentUploadMiddleware` admitted and read, and serves stored attachments
 * to the session's owner and to its paired device.
 */
@Controller([AttachmentRoute.Owner, AttachmentRoute.Device])
@UseFilters(AttachmentFaultFilter)
export class AttachmentsController {
  constructor(
    @Inject(AttachmentAccess) private readonly access: AttachmentAccess,
    @Inject(AttachmentService) private readonly service: AttachmentService,
    @Inject(SourceHistory) private readonly sourceHistory: SourceHistory,
  ) {}

  @Post()
  @HttpCode(HttpStatus.Ok)
  async upload(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { context, deviceMode } = this.access.scope(req);

    await this.access.reauthenticate(req);

    return this.service.store(
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
  }

  // Declared before the GET route: Express answers HEAD with the first matching GET or HEAD route.
  @Head(':attachmentId')
  @UseGuards(AttachmentGuard)
  async available(@Req() req: Request, @Res() res: Response, @Param('attachmentId') id: string) {
    const available = await this.service.available(this.access.scope(req).context, id);

    res.status(available ? HttpStatus.NoContent : HttpStatus.NotFound).end();
  }

  @Get(':attachmentId')
  @UseGuards(AttachmentGuard)
  async download(@Req() req: Request, @Res() res: Response, @Param('attachmentId') id: string) {
    const { context } = this.access.scope(req);
    let result;

    try {
      result = await this.service.read(context, id);
    } catch (error) {
      if (!(error instanceof Fault) || error.code !== AttachmentFaultCode.RebuildRequired) {
        throw error;
      }

      await this.recover(context, await this.service.source(context, id));
      result = await this.service.read(context, id);
    }

    const { descriptor, bytes } = result;

    res.setHeader(
      'Content-Type',
      descriptor.kind === AttachmentKind.Image ? descriptor.mimeType : OCTET_STREAM,
    );

    res.setHeader(
      'Content-Disposition',
      `${descriptor.kind === AttachmentKind.Image ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(descriptor.name).replace(/[!'()*]/gu, (char) => '%' + char.charCodeAt(0).toString(16))}`,
    );

    res.setHeader('Content-Length', bytes.length);
    res.send(bytes);
  }

  // A device-exported attachment whose bytes are gone is rebuilt by reloading the history page it came from.
  private async recover(context: AttachmentContext, source: { messageId: string; position: string }) {
    const page = await this.sourceHistory.page(
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
  }
}
