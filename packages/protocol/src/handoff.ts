import { z } from 'zod';
import { ErrorCode } from './error-codes.js';
import { executionLaunchSelectionSchema } from './execution-profile.js';
import { HandoffPhase } from './values/execution.js';
import {
  checkpointDigestSchema,
  executionIdSchema as id,
  executionTimeSchema as time,
  executionVersionSchema as version,
} from './execution-fields.js';

export const handoffRequestSchema = z.strictObject({
  ownerId: id,
  deviceId: id,
  conversationId: id,
  expectedConversationVersion: version,
  sourceExecutionId: id,
  sourceGeneration: id,
  checkpointId: id,
  checkpointDigest: checkpointDigestSchema,
  expectedProfileVersion: version,
  selection: executionLaunchSelectionSchema,
});

export const handoffOperationSchema = handoffRequestSchema
  .extend({
    id,
    phase: z.enum(HandoffPhase),
    targetExecutionId: id.nullable(),
    createCommandId: id,
    seedCommandId: id,
    updatedAt: time,
    code: z.enum(ErrorCode).optional(),
  })
  .refine(
    (operation) => operation.phase !== HandoffPhase.Ready || operation.targetExecutionId !== null,
    ErrorCode.PROFILE_NOT_READY,
  );

export type HandoffRequest = z.infer<typeof handoffRequestSchema>;
export type HandoffOperation = z.infer<typeof handoffOperationSchema>;
