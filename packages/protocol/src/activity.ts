import { ActivityKind } from './values/index.js';
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
