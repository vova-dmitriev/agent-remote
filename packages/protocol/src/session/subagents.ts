import { SubagentStatus } from './values.js';
import { z } from 'zod';

export const subagentSchema = z.strictObject({
  id: z.string().min(1).max(512),
  name: z.string().min(1).max(512).optional(),
  task: z.string().min(1).max(4096).optional(),
  model: z.string().min(1).max(256).optional(),
  status: z.enum(SubagentStatus),
  updatedAt: z.number().int().nonnegative().safe(),
});
export type SubagentInfo = z.infer<typeof subagentSchema>;
