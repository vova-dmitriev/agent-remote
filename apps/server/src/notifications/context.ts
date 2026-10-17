import { NotificationTurnReason } from '../domain/notifications.js';
import { EventType, MessageRole } from '../../../../packages/protocol/src/index.js';
import { type PoolClient } from 'pg';
import { notificationPreview, notificationTitle } from './format.js';

interface NotificationContext {
  owner_id: string;
  session_id: string | null;
  kind: string;
  created_at: string;
}

export async function notificationContext(tx: PoolClient, row: NotificationContext): Promise<string> {
  const record = (
    await tx.query<{
      device_id: string;
      data: { title?: string; target?: { kind?: string }; errorCode?: string };
    }>(
      'SELECT s.device_id,s.data FROM sessions s JOIN devices d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL',
      [row.owner_id, row.session_id],
    )
  ).rows[0];

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

  const latest = (
    await tx.query<{ data: { type?: string; payload?: { role?: string; text?: string; reason?: string } } }>(
      "SELECT data FROM events WHERE owner_id=$1 AND device_id=$2 AND session_id=$3 AND occurred_at<=$4 AND (data->>'type'=$5 OR (data->>'type'=$6 AND data->'payload'->>'role' IN ($7,$8))) ORDER BY occurred_at DESC,seq DESC LIMIT 2",
      [
        row.owner_id,
        record.device_id,
        row.session_id,
        row.created_at,
        EventType.TurnEnd,
        EventType.Message,
        MessageRole.Assistant,
        MessageRole.User,
      ],
    )
  ).rows.map((item) => item.data);

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
