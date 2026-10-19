import { z } from 'zod';
import { CheckpointApprovalKind, CheckpointCoverage } from '../execution/values.js';
import {
  checkpointDigestSchema,
  executionIdSchema as id,
  executionTimeSchema as time,
  executionVersionSchema as version,
} from '../execution/execution-fields.js';

export const checkpointApprovalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal(CheckpointApprovalKind.Manual), approvedAt: time }),
  z.strictObject({
    kind: z.literal(CheckpointApprovalKind.Policy),
    policyId: id,
    policyVersion: version,
    scopeDigest: checkpointDigestSchema,
  }),
]);

// Bodies, credentials and local file paths do not cross this metadata contract.
export const contextCheckpointSummarySchema = z.strictObject({
  id,
  sourceExecutionId: id,
  sourceGeneration: id,
  historyWatermark: id,
  digest: checkpointDigestSchema,
  createdAt: time,
  coverage: z.enum(CheckpointCoverage),
  messageCount: z.number().int().nonnegative().max(500),
  attachmentCount: z.number().int().nonnegative().max(100),
  estimatedTokens: z.number().int().nonnegative().safe().optional(),
  approval: checkpointApprovalSchema,
});

export type CheckpointApproval = z.infer<typeof checkpointApprovalSchema>;
export type ContextCheckpointSummary = z.infer<typeof contextCheckpointSummarySchema>;
