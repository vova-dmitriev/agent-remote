import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { bytea, epoch } from './columns.js';
import { devices, toDevice } from './devices.js';
import { users } from './identity.js';

export const events = pgTable(
  'events',
  {
    ownerId: text('owner_id').notNull(),
    deviceId: text('device_id').notNull(),
    streamId: text('stream_id').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    eventId: text('event_id').notNull(),
    sessionId: text('session_id'),
    occurredAt: epoch('occurred_at').notNull(),
    data: jsonb('data').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.deviceId, table.streamId, table.seq] }),
    unique().on(table.ownerId, table.deviceId, table.eventId),
    toDevice(table),
    index('events_retention').on(table.deviceId, table.occurredAt),
    index('session_history_page').on(
      table.ownerId,
      table.deviceId,
      table.sessionId,
      table.occurredAt.desc(),
      table.eventId.desc(),
    ),
    index('session_history_ordered_page').on(
      table.ownerId,
      table.deviceId,
      table.sessionId,
      table.occurredAt.desc(),
      table.streamId.desc(),
      table.seq.desc(),
      table.eventId.desc(),
    ),
  ],
);

export const commandAudit = pgTable(
  'command_audit',
  {
    ownerId: text('owner_id').notNull(),
    commandId: text('command_id').notNull(),
    deviceId: text('device_id').notNull(),
    sessionId: text('session_id').notNull(),
    action: text('action').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').notNull(),
    code: text('code'),
    createdAt: epoch('created_at').notNull(),
    resultSessionId: text('result_session_id'),
    createSelection: jsonb('create_selection'),
    createExpectedProfileVersion: integer('create_expected_profile_version'),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.commandId] }),
    foreignKey({ columns: [table.ownerId, table.deviceId], foreignColumns: [devices.ownerId, devices.id] }),
    index('command_audit_created_at').on(table.createdAt),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    ownerId: text('owner_id').notNull(),
    deviceId: text('device_id').notNull(),
    sessionId: text('session_id').notNull(),
    id: text('id').notNull(),
    descriptor: jsonb('descriptor').notNull(),
    bytes: bytea('bytes'),
    createdAt: epoch('created_at').notNull(),
    expiresAt: epoch('expires_at').notNull(),
    blobSha256: text('blob_sha256'),
    deviceExport: boolean('device_export').notNull().default(false),
    sourceMessageId: text('source_message_id'),
    sourcePosition: text('source_position'),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    toDevice(table),
    index('attachments_expiry').on(table.expiresAt),
    index('attachments_session').on(table.ownerId, table.deviceId, table.sessionId),
    index('attachment_blob_references').on(table.ownerId, table.blobSha256),
  ],
);

export const attachmentBlobs = pgTable(
  'attachment_blobs',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sha256: text('sha256').notNull(),
    bytes: bytea('bytes').notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.sha256] })],
);
