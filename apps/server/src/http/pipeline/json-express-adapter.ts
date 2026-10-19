import { ExpressAdapter } from '@nestjs/platform-express';
import type { Response } from 'express';

/**
 * Every handler result is answered as JSON, like the relay always did: `null`/`undefined` become `{}`
 * and primitives are serialized (`"x"`, `1`) instead of Nest's empty body or `text/html` string.
 * A response the handler already wrote is left alone.
 */
export class JsonExpressAdapter extends ExpressAdapter {
  override reply(response: Response, body: unknown, statusCode?: number) {
    if (response.headersSent) {
      return response;
    }

    if (body !== null && typeof body === 'object') {
      return super.reply(response, body, statusCode);
    }

    if (statusCode !== undefined) {
      response.status(statusCode);
    }

    return response.json(body ?? {});
  }
}
