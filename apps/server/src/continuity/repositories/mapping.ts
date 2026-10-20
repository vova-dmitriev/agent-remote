import {
  conversationSchema,
  executionLinkSchema,
  handoffOperationSchema,
  type Conversation,
  type ExecutionLink,
  type HandoffOperation,
} from '@protocol';
import type { continuityConversations, executionLinks, handoffOperations } from '../../db/schema/index.js';

export const asConversation = (row: typeof continuityConversations.$inferSelect): Conversation =>
  conversationSchema.parse({
    id: row.id,
    ownerId: row.ownerId,
    deviceId: row.deviceId,
    activeExecutionId: row.activeExecutionId,
    version: row.version,
    updatedAt: row.updatedAt,
  });
export const asExecution = (row: typeof executionLinks.$inferSelect): ExecutionLink =>
  executionLinkSchema.parse(row);
export const asOperation = (row: typeof handoffOperations.$inferSelect): HandoffOperation =>
  handoffOperationSchema.parse({
    id: row.id,
    ownerId: row.ownerId,
    deviceId: row.deviceId,
    conversationId: row.conversationId,
    expectedConversationVersion: row.expectedConversationVersion,
    sourceExecutionId: row.sourceExecutionId,
    sourceGeneration: row.sourceGeneration,
    checkpointId: row.checkpointId,
    checkpointDigest: row.checkpointDigest.trim(),
    expectedProfileVersion: row.expectedProfileVersion,
    selection: {
      provider: row.targetProvider,
      profileId: row.targetProfileId,
      model: row.targetModel,
      ...(row.targetEffort ? { effort: row.targetEffort } : {}),
    },
    phase: row.phase,
    targetExecutionId: row.targetExecutionId,
    createCommandId: row.createCommandId,
    seedCommandId: row.seedCommandId,
    updatedAt: row.updatedAt,
    ...(row.code ? { code: row.code } : {}),
  });
