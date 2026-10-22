import { Injectable, type NestMiddleware } from '@nestjs/common';
import { HttpStatus } from '@protocol';
import type { NextFunction, Request, Response } from 'express';
import { jsonBodyParser } from './body-parsers.js';

/** JSON bodies up to 128 KB; `RelayModule` excludes the raw attachment uploads. */
@Injectable()
export class JsonBodyMiddleware implements NestMiddleware {
  private readonly parse = jsonBodyParser();

  use(req: Request, res: Response, next: NextFunction) {
    this.parse(req, res, next);
  }
}

/** Hardening headers on every response, including static files and framework errors. */
export const securityHeaders = (_req: Request, res: Response, next: NextFunction) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};

/** A Chrome extension's origin: the scheme and its 32-letter id. */
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/u;

export const isExtensionOrigin = (origin: string | undefined) => !!origin && EXTENSION_ORIGIN.test(origin);

/**
 * Lets a linked Chrome extension call the API from its own origin. It sends a bearer token, never a cookie, so
 * credentials stay disallowed and another site gains nothing; preflights end here.
 */
export const extensionCors = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;

  if (!isExtensionOrigin(origin)) {
    next();

    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin!);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Expose-Headers', 'X-Next-Cursor, X-After-Cursor, X-Upload-Id, X-File-Name');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');

    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Upload-Id, X-File-Name, X-Session-Generation',
    );

    res.setHeader('Access-Control-Max-Age', '600');
    res.status(HttpStatus.NoContent).end();

    return;
  }

  next();
};
