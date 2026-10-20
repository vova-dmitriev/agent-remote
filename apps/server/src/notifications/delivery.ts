import { EventType, HttpStatus } from '@protocol';
import { NotificationKind } from '../domain/notifications.js';
import { notificationContext } from './context.js';
import { notificationCopy } from './copy/messages.js';
import { type NotificationRepository } from './repositories/notifications.js';

export interface TelegramSendResult {
  ok: boolean;
  error_code?: number;
  parameters?: { retry_after?: number };
}
export class NotificationDelivery {
  private perChat = new Map<string, number>();
  private nextGlobal = 0;
  constructor(
    private outbox: NotificationRepository,
    private appUrl: string,
    private send: (body: unknown) => Promise<TelegramSendResult>,
    private reserveChat?: (id: string) => Promise<number>,
  ) {}
  async deliver(now = Date.now(), outboxId?: string): Promise<number> {
    const { outbox } = this;

    return outbox.transaction(async (tx) => {
      const row = await outbox.lockNext(tx, now, outboxId ?? null);

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

      const copy = notificationCopy(row.language);
      let text = copy.deviceUnavailable;

      if (row.kind === NotificationKind.PairPending) {
        text = copy.pairPending;
      } else if (row.kind === NotificationKind.PairQuota) {
        text = copy.pairQuota;
      } else if (row.kind === NotificationKind.PairUnavailable) {
        text = copy.pairUnavailable;
      } else if (
        [EventType.TurnEnd, EventType.Permission].some((candidateValue) => candidateValue === row.kind)
      ) {
        text = await notificationContext(outbox, tx, row);
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
                  text: row.kind.startsWith('pair_') ? copy.openApp : copy.openSession,
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
        await outbox.markSent(tx, row.id);

        return 0;
      }

      if (response.error_code === HttpStatus.Forbidden) {
        await outbox.disableOwner(tx, row.owner_id);
        await outbox.markSent(tx, row.id);

        return 0;
      }

      const retry = Math.max(
        1000,
        (response.parameters?.retry_after ?? Math.min(300, 2 ** Math.min(row.attempts, 8))) * 1000,
      );

      await outbox.retryAt(tx, now + retry, row.id);

      if (response.error_code === HttpStatus.TooManyRequests) {
        this.nextGlobal = now + retry;
      }

      return retry;
    });
  }
}
