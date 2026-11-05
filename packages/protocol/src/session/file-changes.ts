import { FileChangeKind } from '../history/values.js';
import { attachmentSchema } from '../history/attachments.js';
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
  /** A local image the agent named, exported as an attachment when the owner opened it; `content` stays empty. */
  attachment: attachmentSchema.optional(),
});

export const sessionFileQuerySchema = z.strictObject({ path: z.string().min(1).max(4096) });

export type SessionFile = z.infer<typeof sessionFileSchema>;

const WHOLE_IMAGE_PATH = /^(?:~\/|\/(?!\/))[^\n`]*\.(?:png|jpe?g|gif|webp)$/iu;

/** A local image path as a whole, as a code span or a link holds it: absolute or under the home folder. */
export const isLocalImagePath = (value: string) => WHOLE_IMAGE_PATH.test(value);

/**
 * A local image path in running text: no spaces, and not the tail of a URL or of a longer word. A path with spaces is
 * found only as a code span or a link target.
 */
export const LOCAL_IMAGE_PATH_IN_TEXT =
  /(?<![\w:/.~\\-])(?:~\/|\/(?!\/))[^\s`'"<>()[\]{}|]*\.(?:png|jpe?g|gif|webp)(?!\w|\.\w)/giu;

/** The local image paths a message names: in code spans, as link targets and in running text. */
export function localImagePaths(text: string): string[] {
  const found = new Set<string>();

  for (const [, code, target] of text.matchAll(/`([^`\n]+)`|\]\(<?([^)>\n]+)>?\)/gu)) {
    for (const value of [code, target]) {
      if (value && isLocalImagePath(value)) {
        found.add(value);
      }
    }
  }

  for (const [path] of text.matchAll(LOCAL_IMAGE_PATH_IN_TEXT)) {
    found.add(path);
  }

  return [...found];
}
