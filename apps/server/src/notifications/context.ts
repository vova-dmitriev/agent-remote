import { NotificationTurnReason } from '../domain/notifications.js';
import { EventType, MessageRole } from '@protocol';
import { type PoolClient } from 'pg';
import { notificationPreview, notificationTitle } from './format.js';
import { type NotificationRepository } from './repositories/notifications.js';
import { notificationCopy } from './copy/messages.js';

interface NotificationContext {
  owner_id: string;
  session_id: string | null;
  kind: string;
  created_at: number;
  language: string | null;
}

export async function notificationContext(
  outbox: NotificationRepository,
  tx: PoolClient,
  row: NotificationContext,
): Promise<string> {
  const copy = notificationCopy(row.language);
  const record = await outbox.session(tx, row.owner_id, row.session_id);

  const agent = record?.data.target?.kind?.startsWith('codex-') ? 'Codex' : 'Claude';
  const title = record?.data.title ? ' · ' + notificationTitle(record.data.title) : '';

  if (row.kind === EventType.Permission) {
    return record ? copy.permission(agent, title) : copy.permissionUnknownSession;
  }

  if (!record) {
    return copy.finished('');
  }

  const latest = await outbox.latestTurn(tx, row.owner_id, record.device_id, row.session_id, row.created_at);

  const reason = latest.find((item) => item.type === EventType.TurnEnd)?.payload?.reason;

  if (reason === NotificationTurnReason.Interrupted) {
    return copy.interrupted(agent, title);
  }

  if (reason === NotificationTurnReason.Failed || record.data.errorCode) {
    return copy.failed(agent, title);
  }

  const message = latest.find((item) => item.type === EventType.Message)?.payload;

  const preview =
    message?.role === MessageRole.Assistant && typeof message.text === 'string'
      ? notificationPreview(message.text)
      : '';

  return preview ? copy.answered(agent, title, preview) : copy.finished(title);
}
