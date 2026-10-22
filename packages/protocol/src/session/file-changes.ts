import { FileChangeKind } from '../history/values.js';
import { z } from 'zod';

export const sessionFileChangeSchema = z.strictObject({
  id: z.string().min(1).max(2048),
  path: z.string().min(1).max(4096),
  kind: z.enum(FileChangeKind),
  patch: z.string().max(16384),
  truncated: z.boolean(),
  /** When the agent last changed the file, in milliseconds; absent where the source does not say. */
  changedAt: z.number().int().nonnegative().optional(),
});

export const sessionChangesSchema = z.strictObject({
  files: z.array(sessionFileChangeSchema).max(40),
  truncated: z.boolean(),
});

export type SessionFileChange = z.infer<typeof sessionFileChangeSchema>;
export type SessionChanges = z.infer<typeof sessionChangesSchema>;

/** The most of a changed file the app's file view shows; the frame that carries it stays well under the relay cap. */
export const MAX_SESSION_FILE_BYTES = 200 * 1024;

/** A file a session changed, read on the Mac for the app's file view. */
export const sessionFileSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  content: z.string().max(MAX_SESSION_FILE_BYTES),
  truncated: z.boolean(),
});

export const sessionFileQuerySchema = z.strictObject({ path: z.string().min(1).max(4096) });

export type SessionFile = z.infer<typeof sessionFileSchema>;
