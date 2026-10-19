import { Catch, HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ErrorCode } from '@protocol';
import type { Response } from 'express';
import { z } from 'zod';
import { Fault } from './fault.js';

/**
 * Application errors answer `{ code }` with the status derived from the code.
 * Framework errors (body parser, unknown route, undecodable path) keep Nest's default response.
 */
@Catch()
export class FaultFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException || this.isHttpError(exception)) {
      super.catch(exception, host);

      return;
    }

    let fault: Fault;

    if (exception instanceof Fault) {
      fault = exception;
    } else if (exception instanceof z.ZodError) {
      fault = new Fault(ErrorCode.INVALID_REQUEST);
    } else {
      fault = new Fault(ErrorCode.INTERNAL_ERROR);
    }

    const response = host.switchToHttp().getResponse<Response>();

    if (!response.headersSent) {
      response.status(fault.status).json({ code: fault.code });
    }
  }
}
