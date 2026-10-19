import { Catch } from '@nestjs/common';
import { ErrorCode } from '@protocol';
import type { Response } from 'express';
import { z } from 'zod';
import { FaultFilter } from '../../http/errors/fault.filter.js';
import { Fault } from '../../http/errors/fault.js';
import { AttachmentFaultCode } from '../errors.js';

/** Unreadable upload headers and names are invalid attachments, not invalid requests. */
const toAttachmentFault = (error: unknown): Fault => {
  if (error instanceof Fault) {
    return error;
  }

  if (error instanceof z.ZodError || error instanceof URIError) {
    return new Fault(AttachmentFaultCode.Invalid);
  }

  return new Fault(ErrorCode.INTERNAL_ERROR);
};

/** Answers an attachment error from middleware, which runs outside the controller's filter. */
export const replyAttachmentFault = (res: Response, error: unknown) => {
  const fault = toAttachmentFault(error);

  if (!res.headersSent) {
    res.status(fault.status).json({ code: fault.code });
  }
};

@Catch()
export class AttachmentFaultFilter extends FaultFilter {
  protected override toFault(exception: unknown): Fault {
    return toAttachmentFault(exception);
  }
}
