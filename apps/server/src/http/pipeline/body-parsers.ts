import { createRequire } from 'node:module';
import { MAX_ATTACHMENT_BYTES } from '@protocol';
import type { default as express, RequestHandler } from 'express';

// The relay has no direct `express` dependency: its body parsers come from the copy Nest's Express platform uses.
const platformRequire = createRequire(createRequire(import.meta.url).resolve('@nestjs/platform-express'));
const platformExpress = platformRequire('express') as typeof express;

const JSON_BODY_LIMIT = '128kb';

/** JSON bodies up to 128 KB, objects and arrays only. */
export const jsonBodyParser = (): RequestHandler =>
  platformExpress.json({ limit: JSON_BODY_LIMIT, strict: true });

/** Raw bytes whatever the Content-Type, up to the attachment limit, without decompressing. */
export const rawAttachmentParser = (): RequestHandler =>
  platformExpress.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES, inflate: false });
