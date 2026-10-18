import { z } from 'zod';
import { AgentProvider } from './values/command.js';
import { ExecutionMode } from './values/execution.js';
import {
  executionIdSchema as id,
  executionTimeSchema as time,
  executionVersionSchema as version,
} from './execution-fields.js';

export const conversationSchema = z.strictObject({
  id,
  ownerId: id,
  deviceId: id,
  activeExecutionId: id.nullable(),
  version,
  updatedAt: time,
});

export const executionLinkSchema = z.strictObject({
  id,
  conversationId: id,
  ownerId: id,
  deviceId: id,
  provider: z.enum(AgentProvider),
  profileId: z.uuid(),
  mode: z.enum(ExecutionMode),
  nativeSessionId: id,
  generation: id,
  createdAt: time,
});

export type Conversation = z.infer<typeof conversationSchema>;
export type ExecutionLink = z.infer<typeof executionLinkSchema>;
