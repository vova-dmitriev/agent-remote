import { DaemonErrorCode } from '../error-codes.js';
import { z } from 'zod';
import { CodedError } from '@protocol';

export const cmuxContextSchema = z.strictObject({
  windowId: z.uuid(),
  workspaceId: z.uuid(),
  surfaceId: z.uuid(),
});
export type CmuxContext = z.infer<typeof cmuxContextSchema>;

/** The terminal a hook came from, read by the hook command from the Claude process's own cmux environment. */
export const cmuxSurfaceSchema = z.strictObject({
  workspaceId: z.uuid(),
  surfaceId: z.uuid(),
});

export type CmuxSurface = z.infer<typeof cmuxSurfaceSchema>;

/** The surface of a cmux-started Claude process, from its environment; empty outside cmux or with malformed ids. */
export function hookCmuxSurface(env: NodeJS.ProcessEnv): { cmuxSurface?: CmuxSurface } {
  const surface = cmuxSurfaceSchema.safeParse({
    workspaceId: env.CMUX_WORKSPACE_ID,
    surfaceId: env.CMUX_SURFACE_ID,
  });

  return surface.success ? { cmuxSurface: surface.data } : {};
}

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
