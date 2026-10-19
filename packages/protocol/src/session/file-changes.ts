import { FileChangeKind } from '../history/values.js';
import { z } from 'zod';

export const sessionFileChangeSchema = z.strictObject({
  id: z.string().min(1).max(2048),
  path: z.string().min(1).max(4096),
  kind: z.enum(FileChangeKind),
  patch: z.string().max(16384),
  truncated: z.boolean(),
});

export const sessionChangesSchema = z.strictObject({
  files: z.array(sessionFileChangeSchema).max(40),
  truncated: z.boolean(),
});

export type SessionFileChange = z.infer<typeof sessionFileChangeSchema>;
export type SessionChanges = z.infer<typeof sessionChangesSchema>;
