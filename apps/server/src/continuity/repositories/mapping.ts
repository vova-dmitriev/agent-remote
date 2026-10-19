import {
  conversationSchema,
  executionLinkSchema,
  handoffOperationSchema,
  type Conversation,
  type ExecutionLink,
  type HandoffOperation,
} from '@protocol';

export type ContinuityRow = Record<string, unknown>;
export const asConversation = (row: ContinuityRow): Conversation =>
  conversationSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    deviceId: row.device_id,
    activeExecutionId: row.active_execution_id,
    version: Number(row.version),
    updatedAt: Number(row.updated_at),
  });
export const asExecution = (row: ContinuityRow): ExecutionLink =>
  executionLinkSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    ownerId: row.owner_id,
    deviceId: row.device_id,
    provider: row.provider,
    profileId: row.profile_id,
    mode: row.mode,
    nativeSessionId: row.native_session_id,
    generation: row.generation,
    createdAt: Number(row.created_at),
  });
export const asOperation = (row: ContinuityRow): HandoffOperation =>
  handoffOperationSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    deviceId: row.device_id,
    conversationId: row.conversation_id,
    expectedConversationVersion: Number(row.expected_conversation_version),
    sourceExecutionId: row.source_execution_id,
    sourceGeneration: row.source_generation,
    checkpointId: row.checkpoint_id,
    checkpointDigest: String(row.checkpoint_digest).trim(),
    expectedProfileVersion: Number(row.expected_profile_version),
    selection: {
      provider: row.target_provider,
      profileId: row.target_profile_id,
      model: row.target_model,
      ...(row.target_effort ? { effort: row.target_effort } : {}),
    },
    phase: row.phase,
    targetExecutionId: row.target_execution_id,
    createCommandId: row.create_command_id,
    seedCommandId: row.seed_command_id,
    updatedAt: Number(row.updated_at),
    ...(row.code ? { code: row.code } : {}),
  });
