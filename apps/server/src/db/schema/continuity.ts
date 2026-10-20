import { sql } from 'drizzle-orm';
import {
  char,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { epoch } from './columns.js';
import { toDevice } from './devices.js';

export const continuityConversations = pgTable(
  'continuity_conversations',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    deviceId: text('device_id').notNull(),
    activeExecutionId: uuid('active_execution_id'),
    version: integer('version').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [unique().on(table.ownerId, table.deviceId, table.id), toDevice(table)],
);

export const executionLinks = pgTable(
  'execution_links',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id').notNull(),
    ownerId: text('owner_id').notNull(),
    deviceId: text('device_id').notNull(),
    provider: text('provider').notNull(),
    profileId: uuid('profile_id').notNull(),
    mode: text('mode').notNull(),
    nativeSessionId: uuid('native_session_id').notNull(),
    generation: uuid('generation').notNull(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [
    unique().on(table.ownerId, table.deviceId, table.conversationId, table.id),
    unique().on(table.ownerId, table.deviceId, table.provider, table.nativeSessionId, table.generation),
    toDevice(table),
    foreignKey({
      columns: [table.ownerId, table.deviceId, table.conversationId],
      foreignColumns: [
        continuityConversations.ownerId,
        continuityConversations.deviceId,
        continuityConversations.id,
      ],
    }).onDelete('cascade'),
  ],
);

export const handoffOperations = pgTable(
  'handoff_operations',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    deviceId: text('device_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    sourceExecutionId: uuid('source_execution_id').notNull(),
    sourceGeneration: uuid('source_generation').notNull(),
    checkpointId: uuid('checkpoint_id').notNull(),
    checkpointDigest: char('checkpoint_digest', { length: 64 }).notNull(),
    expectedConversationVersion: integer('expected_conversation_version').notNull(),
    expectedProfileVersion: integer('expected_profile_version').notNull(),
    targetProvider: text('target_provider').notNull(),
    targetProfileId: uuid('target_profile_id').notNull(),
    targetModel: text('target_model').notNull(),
    targetEffort: text('target_effort'),
    phase: text('phase').notNull(),
    targetExecutionId: uuid('target_execution_id'),
    createCommandId: uuid('create_command_id').notNull().unique(),
    seedCommandId: uuid('seed_command_id').notNull().unique(),
    requestFingerprint: char('request_fingerprint', { length: 64 }).notNull(),
    operationVersion: integer('operation_version').notNull().default(1),
    code: text('code'),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [
    unique().on(table.ownerId, table.deviceId, table.id),
    unique().on(table.ownerId, table.deviceId, table.conversationId, table.id),
    toDevice(table),
    uniqueIndex('one_active_handoff_per_conversation')
      .on(table.ownerId, table.deviceId, table.conversationId)
      .where(sql`${table.phase} NOT IN ('ready', 'failed')`),
  ],
);

export const handoffCommandIds = pgTable(
  'handoff_command_ids',
  {
    commandId: uuid('command_id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    deviceId: text('device_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    kind: text('kind').notNull(),
  },
  (table) => [unique().on(table.ownerId, table.deviceId, table.operationId, table.kind), toDevice(table)],
);

export const commandIdClaims = pgTable(
  'command_id_claims',
  {
    commandId: uuid('command_id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    deviceId: text('device_id').notNull(),
    operationId: uuid('operation_id'),
    kind: text('kind').notNull(),
    fingerprint: char('fingerprint', { length: 64 }).notNull(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [toDevice(table), index('command_id_claims_device').on(table.ownerId, table.deviceId)],
);

export const handoffSeedProofs = pgTable('handoff_seed_proofs', {
  operationId: uuid('operation_id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  deviceId: text('device_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  deviceGeneration: uuid('device_generation').notNull(),
  seedCommandId: uuid('seed_command_id').notNull().unique(),
  checkpointId: uuid('checkpoint_id').notNull(),
  checkpointDigest: char('checkpoint_digest', { length: 64 }).notNull(),
  targetExecutionId: uuid('target_execution_id').notNull(),
  targetGeneration: uuid('target_generation').notNull(),
  targetProfileId: uuid('target_profile_id').notNull(),
  targetProvider: text('target_provider').notNull(),
  targetModel: text('target_model').notNull(),
  targetEffort: text('target_effort'),
  receivedAt: epoch('received_at').notNull(),
});
