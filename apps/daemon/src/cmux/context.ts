import { DaemonErrorCode } from '../error-codes.js';
import { z } from 'zod';
import { CodedError } from '@protocol';

export const cmuxContextSchema = z.strictObject({
  windowId: z.uuid(),
  workspaceId: z.uuid(),
  surfaceId: z.uuid(),
});
export type CmuxContext = z.infer<typeof cmuxContextSchema>;

export function cmuxContext(env: NodeJS.ProcessEnv = process.env, windowId?: string): CmuxContext {
  const result = cmuxContextSchema.safeParse({
    windowId: windowId ?? env.CMUX_WINDOW_ID,
    workspaceId: env.CMUX_WORKSPACE_ID,
    surfaceId: env.CMUX_SURFACE_ID,
  });

  if (!result.success) {
    throw new CodedError(DaemonErrorCode.INVALID_CMUX_CONTEXT);
  }

  return result.data;
}
