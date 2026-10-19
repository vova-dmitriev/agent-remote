import { EventType, HttpStatus } from '@protocol';
import { NotificationKind } from '../domain/notifications.js';
import { type Database } from '../db/database.js';
import { notificationContext } from './context.js';

export interface TelegramSendResult {
  ok: boolean;
  error_code?: number;
  parameters?: { retry_after?: number };
}
interface OutboxRow {
  id: string;
  owner_id: string;
  private_chat_id: string;
  kind: string;
  session_id: string | null;
  attempts: number;
  next_attempt_at: string;
  created_at: string;
}

export class NotificationDelivery {
  private perChat = new Map<string, number>();
  private nextGlobal = 0;
  constructor(
    private db: Database,
    private appUrl: string,
    private send: (body: unknown) => Promise<TelegramSendResult>,
    private reserveChat?: (id: string) => Promise<number>,
  ) {}
  async deliver(now = Date.now(), outboxId?: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query<OutboxRow>(
          'SELECT o.*,u.private_chat_id FROM notification_outbox o JOIN users u ON u.id=o.owner_id WHERE o.sent=false AND ($2::text IS NULL OR o.id=$2) AND ($2::text IS NOT NULL OR o.next_attempt_at<=$1) AND u.private_chat_id IS NOT NULL AND u.notifications_enabled=true ORDER BY o.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED',
          [now, outboxId ?? null],
        )
      ).rows[0];

      if (!row) {
        return 0;
      }

      const deadline = Number(row.next_attempt_at);

      if (deadline > now) {
        return deadline - now;
      }

      if (now < this.nextGlobal) {
        return this.nextGlobal - now;
      }

      const chatDelay = this.reserveChat
        ? await this.reserveChat(row.private_chat_id)
        : Math.max(0, (this.perChat.get(row.private_chat_id) ?? 0) - now);

      if (chatDelay > 0) {
        return chatDelay;
      }

      for (const [chat, at] of this.perChat) {
        if (at <= now) {
          this.perChat.delete(chat);
        }
      }

      this.perChat.set(row.private_chat_id, now + 1000);
      this.nextGlobal = now + 34;

      let text = 'Mac недоступен.';

      if (row.kind === NotificationKind.PairPending) {
        text = 'Подтверди подключение на Mac. Затем открой Agent Remote кнопкой ниже.';
      } else if (row.kind === NotificationKind.PairQuota) {
        text =
          'У этого аккаунта уже подключён Mac. Используй его или отзови доступ в приложении перед новым подключением.';
      } else if (row.kind === NotificationKind.PairUnavailable) {
        text = 'Ссылка подключения недоступна. Запусти подключение заново на Mac.';
      } else if (
        [EventType.TurnEnd, EventType.Permission].some((candidateValue) => candidateValue === row.kind)
      ) {
        text = await notificationContext(tx, row);
      }

      const url = new URL(this.appUrl);

      if (row.session_id) {
        url.hash = 'session=' + encodeURIComponent(row.session_id);
      }

      let response: TelegramSendResult;

      try {
        response = await this.send({
          chat_id: row.private_chat_id,
          text,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: row.kind.startsWith('pair_') ? 'Открыть Agent Remote' : 'Открыть сессию',
                  web_app: { url: url.toString() },
                },
              ],
            ],
          },
        });
      } catch {
        response = { ok: false };
      }

      if (response.ok) {
        await tx.query('UPDATE notification_outbox SET sent=true WHERE id=$1', [row.id]);

        return 0;
      }

      if (response.error_code === HttpStatus.Forbidden) {
        await tx.query('UPDATE users SET notifications_enabled=false WHERE id=$1', [row.owner_id]);
        await tx.query('UPDATE notification_outbox SET sent=true WHERE id=$1', [row.id]);

        return 0;
      }

      const retry = Math.max(
        1000,
        (response.parameters?.retry_after ?? Math.min(300, 2 ** Math.min(row.attempts, 8))) * 1000,
      );

      await tx.query('UPDATE notification_outbox SET attempts=attempts+1,next_attempt_at=$1 WHERE id=$2', [
        now + retry,
        row.id,
      ]);

      if (response.error_code === HttpStatus.TooManyRequests) {
        this.nextGlobal = now + retry;
      }

      return retry;
    });
  }
}
