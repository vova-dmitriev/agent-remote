import { z } from 'zod';
import { AgentProvider } from '../session/command-values.js';
import { ExecutionMode, CheckpointCoverage } from '../execution/values.js';
import { ContinuityCompatibilityReason, ContinuityLocalRequestKind } from './values.js';
import { ErrorCode } from '../errors/error-codes.js';
import { contextCheckpointSummarySchema } from './context-checkpoint.js';
import { conversationSchema, executionLinkSchema } from '../execution/conversation.js';
import { handoffOperationSchema, startHandoffRequestSchema } from './handoff.js';
import {
  checkpointDigestSchema,
  executionIdSchema as id,
  executionVersionSchema as version,
} from '../execution/execution-fields.js';

export const continuityCheckpointSelectionSchema = z.strictObject({
  selectedMessageIds: z.array(id).max(500),
  selectedAttachmentIds: z.array(id).max(100),
  constraints: z.array(z.string().trim().min(1).max(2048)).max(32),
});

export const continuitySourceInspectionSchema = z
  .strictObject({
    supported: z.boolean(),
    reason: z.enum(ContinuityCompatibilityReason).optional(),
    sessionId: id,
    generation: id,
    provider: z.enum(AgentProvider).optional(),
    profileId: z.uuid().optional(),
    profileVersion: version.optional(),
    mode: z.enum(ExecutionMode).optional(),
  })
  .refine(
    (value) =>
      value.supported
        ? Boolean(value.provider && value.profileId && value.profileVersion && value.mode)
        : value.reason !== undefined,
    ErrorCode.CONTINUITY_INSPECTION_INCOMPLETE,
  );

export const continuityCheckpointDraftSchema = z.strictObject({
  id,
  digest: checkpointDigestSchema,
  approved: z.literal(false),
  sourceExecutionId: id,
  sourceGeneration: id,
  historyWatermark: id,
  coverage: z.enum(CheckpointCoverage),
  messageCount: z.number().int().nonnegative().max(500),
  attachmentCount: z.number().int().nonnegative().max(100),
  estimatedTokens: z.number().int().nonnegative().safe(),
  missingMessageIds: z.array(id).max(500),
  textTruncated: z.boolean(),
  byteCount: z.number().int().nonnegative().safe(),
});

export const continuityLocalRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal(ContinuityLocalRequestKind.InspectSource),
    sessionId: id,
    generation: id,
  }),
  z.strictObject({
    kind: z.literal(ContinuityLocalRequestKind.PrepareCheckpoint),
    conversationId: id,
    executionId: id,
    expectedConversationVersion: version,
    selection: continuityCheckpointSelectionSchema,
  }),
  z.strictObject({
    kind: z.literal(ContinuityLocalRequestKind.ApproveCheckpoint),
    sessionId: id,
    generation: id,
    checkpointId: id,
    expectedDraftDigest: checkpointDigestSchema,
    editedSummary: z.string().max(32_000),
  }),
]);

export const continuityLocalResponseSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal(ContinuityLocalRequestKind.InspectSource),
    data: continuitySourceInspectionSchema,
  }),
  z.strictObject({
    kind: z.literal(ContinuityLocalRequestKind.PrepareCheckpoint),
    data: z.strictObject({ draft: continuityCheckpointDraftSchema, previewText: z.string().max(65_536) }),
  }),
  z.strictObject({
    kind: z.literal(ContinuityLocalRequestKind.ApproveCheckpoint),
    data: contextCheckpointSummarySchema,
  }),
]);

export const continuityInspectionSchema = z.strictObject({
  source: continuitySourceInspectionSchema,
  conversation: conversationSchema.nullable(),
  sourceExecution: executionLinkSchema.nullable(),
  pendingHandoff: handoffOperationSchema.nullable(),
});

export const continuityConversationRequestSchema = z.strictObject({
  deviceId: id,
  conversationId: z.uuid(),
  sessionId: id,
  generation: id,
});

export const continuityListLinksRequestSchema = z.strictObject({
  deviceId: id,
  conversationId: id,
});

export const continuityLinksSchema = z.strictObject({
  conversation: conversationSchema,
  executions: z.array(executionLinkSchema).max(100),
  pendingHandoff: handoffOperationSchema.nullable(),
});

export const continuityOperationRequestSchema = z.strictObject({ deviceId: id, operationId: z.uuid() });

export const continuityPrepareRequestSchema = z.strictObject({
  kind: z.literal(ContinuityLocalRequestKind.PrepareCheckpoint),
  deviceId: id,
  conversationId: id,
  executionId: id,
  expectedConversationVersion: version,
  selection: continuityCheckpointSelectionSchema,
});

export const continuityApproveRequestSchema = z.strictObject({
  kind: z.literal(ContinuityLocalRequestKind.ApproveCheckpoint),
  deviceId: id,
  sessionId: id,
  generation: id,
  checkpointId: id,
  expectedDraftDigest: checkpointDigestSchema,
  editedSummary: z.string().max(32_000),
});

export type ContinuityCheckpointSelection = z.infer<typeof continuityCheckpointSelectionSchema>;
export type ContinuitySourceInspection = z.infer<typeof continuitySourceInspectionSchema>;
export type ContinuityCheckpointDraft = z.infer<typeof continuityCheckpointDraftSchema>;
export type ContinuityLocalRequest = z.infer<typeof continuityLocalRequestSchema>;
export type ContinuityLocalResponse = z.infer<typeof continuityLocalResponseSchema>;
export type ContinuityInspection = z.infer<typeof continuityInspectionSchema>;
export type ContinuityConversationRequest = z.infer<typeof continuityConversationRequestSchema>;
export type ContinuityListLinksRequest = z.infer<typeof continuityListLinksRequestSchema>;
export type ContinuityLinks = z.infer<typeof continuityLinksSchema>;
export type ContinuityOperationRequest = z.infer<typeof continuityOperationRequestSchema>;
export type ContinuityPrepareRequest = z.infer<typeof continuityPrepareRequestSchema>;
export type ContinuityApproveRequest = z.infer<typeof continuityApproveRequestSchema>;
export const continuityInspectRequestSchema = z.strictObject({
  deviceId: id,
  sessionId: id,
  generation: id,
});
export type ContinuityInspectRequest = z.infer<typeof continuityInspectRequestSchema>;

export interface ContinuityAccess {
  inspect(input: ContinuityInspectRequest): Promise<ContinuityInspection>;
  createConversation(input: ContinuityConversationRequest): Promise<ContinuityLinks>;
  listLinks(input: ContinuityListLinksRequest): Promise<ContinuityLinks>;
  prepareCheckpoint(input: ContinuityPrepareRequest): Promise<ContinuityLocalResponse>;
  approveCheckpoint(input: ContinuityApproveRequest): Promise<ContinuityLocalResponse>;
  startHandoff(
    input: z.infer<typeof startHandoffRequestSchema>,
  ): Promise<z.infer<typeof handoffOperationSchema>>;
  getHandoff(input: ContinuityOperationRequest): Promise<z.infer<typeof handoffOperationSchema>>;
  reconcileHandoff(input: ContinuityOperationRequest): Promise<z.infer<typeof handoffOperationSchema>>;
}
