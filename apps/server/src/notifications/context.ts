import { NotificationTurnReason } from '../domain/notifications.js';
import { EventType, MessageRole } from '@protocol';
import { type PoolClient } from 'pg';
import { notificationPreview, notificationTitle } from './format.js';
import { type NotificationRepository } from './repositories/notifications.js';

interface NotificationContext {
  owner_id: string;
  session_id: string | null;
  kind: string;
  created_at: string;
}

export async function notificationContext(
  outbox: NotificationRepository,
  tx: PoolClient,
  row: NotificationContext,
): Promise<string> {
  const record = await outbox.session(tx, row.owner_id, row.session_id);

  const agent = record?.data.target?.kind?.startsWith('codex-') ? 'Codex' : 'Claude';
  const title = record?.data.title ? ' · ' + notificationTitle(record.data.title) : '';

  if (row.kind === EventType.Permission) {
    return record
      ? `${agent} ждёт разрешения${title}. Открой сессию, чтобы подтвердить или отклонить действие.`
      : 'Агент запрашивает разрешение.';
  }

  if (!record) {
    return 'Обработка запроса закончилась. Открой сессию, чтобы проверить результат.';
  }

  const latest = await outbox.latestTurn(tx, row.owner_id, record.device_id, row.session_id, row.created_at);

  const reason = latest.find((item) => item.type === EventType.TurnEnd)?.payload?.reason;

  if (reason === NotificationTurnReason.Interrupted) {
    return `${agent} остановлен${title}. Открой сессию, чтобы продолжить.`;
  }

  if (reason === NotificationTurnReason.Failed || record.data.errorCode) {
    return `${agent} не смог завершить запрос${title}. Открой сессию, чтобы посмотреть причину.`;
  }

  const message = latest.find((item) => item.type === EventType.Message)?.payload;

  const preview =
    message?.role === MessageRole.Assistant && typeof message.text === 'string'
      ? notificationPreview(message.text)
      : '';

  return preview
    ? `${agent} ответил${title}\n\n${preview}`
    : `Обработка запроса закончилась${title}. Открой сессию, чтобы проверить результат.`;
}
