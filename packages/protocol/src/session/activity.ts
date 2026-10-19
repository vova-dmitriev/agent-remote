import { ActivityKind, ToolActivityPhase } from './values.js';
import { z } from 'zod';

export const ACTIVITY_KINDS = [
  ActivityKind.Command,
  ActivityKind.Read,
  ActivityKind.Write,
  ActivityKind.Search,
  ActivityKind.Web,
  ActivityKind.Tool,
] as const;
export const sessionActivitySchema = z.strictObject({
  id: z.string().min(1).max(512),
  kind: z.enum(ActivityKind),
  startedAt: z.number().int().nonnegative().safe(),
});
export type SessionActivity = z.infer<typeof sessionActivitySchema>;

/**
 * One tool call or result carried by a history item. Readers tolerate a newer writer: unknown keys are
 * stripped, an unknown phase reads as completed and an unknown kind reads as the generic tool kind.
 */
export const toolActivitySchema = z.object({
  id: z.string().min(1).max(512),
  // Required: an unknown phase from a newer writer reads as completed; a missing one is rejected.
  phase: z.union([z.enum(ToolActivityPhase), z.string().transform(() => ToolActivityPhase.Completed)]),
  name: z.string().min(1).max(256).optional().catch(undefined),
  kind: z.enum(ActivityKind).catch(ActivityKind.Tool).optional(),
});
export type ToolActivity = z.infer<typeof toolActivitySchema>;
