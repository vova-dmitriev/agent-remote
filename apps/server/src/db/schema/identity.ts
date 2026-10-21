import { boolean, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { epoch } from './columns.js';

/** Mirrors migrations 001–008; the schema-drift test compares every column against a migrated database. */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  telegramId: text('telegram_id').notNull().unique(),
  createdAt: epoch('created_at').notNull(),
  privateChatId: text('private_chat_id'),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
});

export const browserSessions = pgTable(
  'browser_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: epoch('expires_at').notNull(),
  },
  (table) => [index('browser_sessions_expiry').on(table.expiresAt)],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: epoch('expires_at').notNull(),
    browserSessionHash: text('browser_session_hash').references(() => browserSessions.tokenHash, {
      onDelete: 'cascade',
    }),
  },
  (table) => [index('auth_browser_session').on(table.browserSessionHash)],
);

export const pairings = pgTable('pairings', {
  codeHash: text('code_hash').primaryKey(),
  proofHash: text('proof_hash').notNull().unique(),
  expiresAt: epoch('expires_at').notNull(),
  claimId: text('claim_id').unique(),
  ownerId: text('owner_id').references(() => users.id),
  consumed: boolean('consumed').notNull().default(false),
});

export const userPreferences = pgTable('user_preferences', {
  ownerId: text('owner_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  language: text('language'),
  theme: text('theme'),
});

export const botState = pgTable('bot_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const notificationOutbox = pgTable('notification_outbox', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  sessionId: text('session_id'),
  kind: text('kind').notNull(),
  createdAt: epoch('created_at').notNull(),
  nextAttemptAt: epoch('next_attempt_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  sent: boolean('sent').notNull().default(false),
  /** What a notification is about when its kind alone does not say: a rate-limit window. */
  payload: jsonb('payload'),
});
