import { Catch, HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { reportFault } from './error-log.js';
import { toFault, type Fault } from './fault.js';

/**
 * Application errors answer `{ code }` with the status derived from the code.
 * An unexpected error answers 500 `INTERNAL_ERROR`; only the log gets its details.
 * Framework errors (body parser, unknown route, undecodable path) keep Nest's default response.
 */
@Catch()
export class FaultFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException || this.isHttpError(exception)) {
      super.catch(exception, host);

      return;
    }

    const fault = reportFault(exception, this.toFault(exception));
    const response = host.switchToHttp().getResponse<Response>();

    if (!response.headersSent) {
      response.status(fault.status).json({ code: fault.code });
    }
  }

  /** Validation errors are invalid requests, the rest internal; a route group may report them differently. */
  protected toFault(exception: unknown): Fault {
    return toFault(exception);
  }
}
