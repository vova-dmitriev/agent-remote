import { randomBytes } from 'node:crypto';
import { ReadyRule, RemotePermissionDecision, RULE_ANSWER_TIMEOUT_MS, permissionRuleSchema } from '@protocol';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { NotificationCopy } from '../copy/messages.js';
import { notificationCommand, notificationTitle } from '../format.js';
import type { NotificationRepository, OutboxRow } from '../repositories/notifications.js';

/** One letter per answer in a button's `callback_data`, which Telegram caps at 64 bytes. */
const DECISION_CODES: Record<RemotePermissionDecision, string> = {
  [RemotePermissionDecision.Allow]: 'a',
  [RemotePermissionDecision.AllowAlways]: 'A',
  [RemotePermissionDecision.Deny]: 'd',
};

const READY_PREFIX = 'ready-';

const payloadSchema = z.object({
  rule: permissionRuleSchema,
  command: z.string().min(1),
  requestId: z.string().min(1).max(512),
  generation: z.string().min(1).max(512),
});

/** A pressed button's decision and token, or undefined for data this bot did not send. */
export function pressedButton(data: string | undefined) {
  const [code, token] = (data ?? '').split(':');
  const decision = Object.values(RemotePermissionDecision).find((value) => DECISION_CODES[value] === code);

  return decision && token && /^[\w-]{22}$/u.test(token) ? { decision, token } : undefined;
}

/**
 * The ❗ message for a command an owner's rule stopped, with Allow once / Always allow / Deny buttons; undefined
 * for an agent's own permission prompt, which keeps its usual text.
 */
export async function ruleMessage(
  outbox: NotificationRepository,
  tx: PoolClient,
  row: OutboxRow,
  copy: NotificationCopy,
) {
  if (!row.session_id) {
    return undefined;
  }

  const event = await outbox.actions.latestPermission(
    tx,
    row.owner_id,
    row.session_id,
    Number(row.created_at),
  );

  const parsed = payloadSchema.safeParse(event?.data.payload);

  if (!event || !parsed.success) {
    return undefined;
  }

  const { rule, command, requestId, generation } = parsed.data;
  const record = await outbox.session(tx, row.owner_id, row.session_id);
  const agent = record?.data.target?.kind?.startsWith('codex-') ? 'Codex' : 'Claude';
  const title = record?.data.title ? ' · ' + notificationTitle(record.data.title) : '';
  const ready = Object.values(ReadyRule).find((value) => rule.id === READY_PREFIX + value);
  const token = randomBytes(16).toString('base64url');

  await outbox.actions.save(tx, {
    token,
    ownerId: row.owner_id,
    deviceId: event.deviceId,
    sessionId: row.session_id,
    requestId,
    generation,
    expiresAt: Number(row.created_at) + RULE_ANSWER_TIMEOUT_MS,
  });

  const button = (text: string, decision: RemotePermissionDecision) => ({
    text,
    callback_data: `${DECISION_CODES[decision]}:${token}`,
  });

  return {
    text: copy.rulePermission(
      agent,
      ready ? copy.readyRules[ready] : notificationTitle(rule.name),
      title,
      notificationCommand(command),
    ),
    buttons: [
      button(copy.allowOnce, RemotePermissionDecision.Allow),
      button(copy.allowAlways, RemotePermissionDecision.AllowAlways),
      button(copy.deny, RemotePermissionDecision.Deny),
    ],
  };
}
