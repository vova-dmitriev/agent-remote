import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { epoch } from './columns.js';
import { users } from './identity.js';

export const devices = pgTable(
  'devices',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    generation: text('generation').notNull(),
    revokedAt: epoch('revoked_at'),
    lastSeenAt: epoch('last_seen_at').notNull().default(0),
    snapshot: jsonb('snapshot'),
    connectors: jsonb('connectors')
      .notNull()
      .default(sql`'[]'`),
    historyRevision: bigint('history_revision', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    unique().on(table.ownerId, table.id),
    uniqueIndex('one_active_device')
      .on(table.ownerId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

/** Columns every device-scoped table shares, and its cascade to the owner's device. */
const ownedDevice = {
  ownerId: text('owner_id').notNull(),
  deviceId: text('device_id').notNull(),
};

/** Cascades a device-scoped row with its owner's device. */
export const toDevice = (table: { ownerId: AnyPgColumn; deviceId: AnyPgColumn }) =>
  foreignKey({
    columns: [table.ownerId, table.deviceId],
    foreignColumns: [devices.ownerId, devices.id],
  }).onDelete('cascade');

export const sessions = pgTable(
  'sessions',
  { ...ownedDevice, id: text('id').notNull(), data: jsonb('data').notNull() },
  (table) => [primaryKey({ columns: [table.ownerId, table.deviceId, table.id] }), toDevice(table)],
);

export const sessionCatalog = pgTable(
  'session_catalog',
  {
    ...ownedDevice,
    id: text('id').notNull(),
    deviceGeneration: text('device_generation'),
    provider: text('provider').notNull(),
    recencyAt: epoch('recency_at').notNull(),
    data: jsonb('data').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.deviceId, table.id] }),
    toDevice(table),
    index('session_catalog_page').on(
      table.ownerId,
      table.deviceId,
      table.provider,
      table.recencyAt.desc(),
      table.id,
    ),
  ],
);

export const sessionLabels = pgTable(
  'session_labels',
  { ...ownedDevice, sourceKey: text('source_key').notNull(), title: text('title').notNull() },
  (table) => [primaryKey({ columns: [table.ownerId, table.deviceId, table.sourceKey] }), toDevice(table)],
);

export const sessionActivity = pgTable(
  'session_activity',
  {
    ...ownedDevice,
    sessionId: text('session_id').notNull(),
    lastMessageAt: epoch('last_message_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.deviceId, table.sessionId] }), toDevice(table)],
);

export const readingPositions = pgTable(
  'reading_positions',
  {
    ...ownedDevice,
    sessionId: text('session_id').notNull(),
    messageId: text('message_id').notNull(),
    pixelOffset: doublePrecision('pixel_offset').notNull(),
    cursor: text('cursor'),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.deviceId, table.sessionId] }), toDevice(table)],
);

export const executionProfileMetadata = pgTable(
  'execution_profile_metadata',
  { ...ownedDevice, data: jsonb('data').notNull() },
  (table) => [primaryKey({ columns: [table.ownerId, table.deviceId] }), toDevice(table)],
);

export const profileRoutingSettings = pgTable(
  'profile_routing_settings',
  {
    ...ownedDevice,
    version: integer('version').notNull(),
    data: jsonb('data').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.deviceId] }), toDevice(table)],
);

export const profileQuotaObservations = pgTable(
  'profile_quota_observations',
  {
    ...ownedDevice,
    profileId: uuid('profile_id').notNull(),
    scopeKey: text('scope_key').notNull(),
    observedAt: epoch('observed_at').notNull(),
    data: jsonb('data').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.deviceId, table.profileId, table.scopeKey] }),
    toDevice(table),
    index('profile_quota_observations_latest').on(table.ownerId, table.deviceId, table.observedAt.desc()),
  ],
);
