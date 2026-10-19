import { isAbsolute } from 'node:path';
import { TargetKind } from '@protocol';
import { z } from 'zod';

export const codexConnectionSchema = z.strictObject({
  kind: z.enum([TargetKind.CodexCli, TargetKind.CodexDesktop]),
  socketPath: z.string().min(1).max(4096).refine(isAbsolute),
  threadId: z.string().min(1).max(512).optional(),
});
export type CodexConnection = z.infer<typeof codexConnectionSchema>;
