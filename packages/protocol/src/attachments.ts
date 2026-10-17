import { AttachmentKind } from './values/index.js';
import { z } from 'zod';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export const MAX_MESSAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

export const attachmentSchema = z.strictObject({
  id: z.string().min(1).max(512),
  name: z
    .string()
    .min(1)
    .max(255)
    // eslint-disable-next-line no-control-regex -- Intentionally reject control characters at the wire boundary.
    .refine((name) => !/[\x00-\x1f\x7f]/u.test(name)),
  mimeType: z.string().min(1).max(128),
  byteLength: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  kind: z.enum(AttachmentKind),
});

export const attachmentsSchema = z
  .array(attachmentSchema)
  .max(MAX_ATTACHMENTS)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'DUPLICATE_ATTACHMENT')
  .refine(
    (items) => items.reduce((sum, item) => sum + item.byteLength, 0) <= MAX_MESSAGE_ATTACHMENT_BYTES,
    'ATTACHMENTS_TOO_LARGE',
  );

export type AttachmentDescriptor = z.infer<typeof attachmentSchema>;
