import { Injectable, type NestMiddleware } from '@nestjs/common';
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
