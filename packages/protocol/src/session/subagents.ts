import { SubagentStatus } from './values.js';
import { z } from 'zod';

/** A subagent id names one transcript file, so it is a single safe path component. */
export const SUBAGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const subagentIdSchema = z.string().regex(SUBAGENT_ID_PATTERN);

/**
 * Readers tolerate a newer writer: unknown keys are stripped, an unknown status reads as `unknown`
 * and an invalid optional detail is dropped instead of rejecting the whole snapshot.
 */
export const subagentSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().min(1).max(512).optional(),
  task: z.string().min(1).max(4096).optional(),
  model: z.string().min(1).max(256).optional(),
  type: z.string().min(1).max(256).optional().catch(undefined),
  description: z.string().min(1).max(4096).optional().catch(undefined),
  transcriptAvailable: z.boolean().optional().catch(undefined),
  status: z.enum(SubagentStatus).catch(SubagentStatus.Unknown),
  updatedAt: z.number().int().nonnegative().safe(),
});
export type SubagentInfo = z.infer<typeof subagentSchema>;
