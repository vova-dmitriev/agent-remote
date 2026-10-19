import { TelegramUpdateType, TelegramChatType, NotificationKind } from '../domain/notifications.js';
import { NotificationDelivery } from './delivery.js';
import { NotificationRepository } from './repositories/notifications.js';
import { type NotificationQueue } from './queue.js';
import { randomUUID } from 'node:crypto';
import { DeviceRepository } from '../devices/repositories/devices.js';
import { PairingRepository } from '../devices/repositories/pairings.js';
import { DeviceService } from '../devices/service.js';
import { hash } from '../auth/security.js';
import { Fault } from '../http/errors/fault.js';
import { type Database } from '../db/database.js';

interface TelegramResult<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  parameters?: { retry_after?: number };
}
interface Update {
  update_id: number;
  message?: { text?: string; from?: { id: number }; chat?: { id: number; type: string } };
}
export class NotificationWorker {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller = new AbortController();
  private delivery: NotificationDelivery;
  private outbox: NotificationRepository;
  private devices: DeviceService;
  private sending: Promise<void> = Promise.resolve();
  private polling: Promise<void> = Promise.resolve();
  constructor(
    db: Database,
    private botToken: string,
    private appUrl: string,
    private fetcher: typeof fetch = fetch,
    private broker?: NotificationQueue,
  ) {
    this.outbox = new NotificationRepository(db);
    this.devices = new DeviceService(new DeviceRepository(db), new PairingRepository(db));

    this.delivery = new NotificationDelivery(
      this.outbox,
      appUrl,
      (body) => this.api('sendMessage', body),
      broker ? (id) => broker.reserveChat(id) : undefined,
    );
  }
  private async api<T>(method: string, body: unknown): Promise<TelegramResult<T>> {
    const response = await this.fetcher(`https://api.telegram.org/bot${this.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(35000)]),
    });

    return response.json() as Promise<TelegramResult<T>>;
  }
  async updates(updates: Update[]) {
    for (const update of updates) {
      const message = update.message;

      if (
        message?.text?.match(/^\/start(?:\s|$)/) &&
        message.chat?.type === TelegramChatType.Private &&
        message.from?.id === message.chat.id
      ) {
        const telegramId = String(message.from.id);

        const owner = await this.outbox.registerChat(randomUUID(), telegramId, Date.now());

        const code = message.text.match(/^\/start\s+pair_([a-f0-9]{32})\s*$/)?.[1];

        if (code) {
          let kind: NotificationKind = NotificationKind.PairPending,
            key: string;

          try {
            const claim = await this.devices.claim({ userId: owner, telegramId }, code);

            key = claim.claimId;
          } catch (error) {
            if (!(error instanceof Fault)) {
              throw error;
            }

            kind =
              error.code === 'DEVICE_QUOTA' ? NotificationKind.PairQuota : NotificationKind.PairUnavailable;

            key = String(update.update_id);
          }

          const id = hash(owner + ':' + kind + ':' + key);

          await this.outbox.recordPairing(id, owner, kind, Date.now());

          void this.broker?.enqueue(id).catch(() => {
            /* Outbox reconciliation retries enqueue. */
          });
        }
      }

      await this.outbox.saveOffset(String(update.update_id + 1));
    }
  }
  async deliver(now = Date.now()) {
    await this.delivery.deliver(now);
  }
  async start() {
    if (this.broker) {
      await this.broker.start((id) => this.delivery.deliver(Date.now(), id));
    }

    const polling = async () => {
      while (!this.stopped) {
        try {
          const offset = await this.outbox.offset();

          const result = await this.api<Update[]>('getUpdates', {
            offset: Number(offset ?? 0),
            timeout: 25,
            allowed_updates: [TelegramUpdateType.Message],
            limit: 100,
          });

          if (result.ok) {
            await this.updates(result.result ?? []);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch {
          if (!this.stopped) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }
    };

    const sending = async () => {
      if (this.stopped) {
        return;
      }

      try {
        if (this.broker) {
          await this.broker.reconcile(this.outbox);
        } else {
          await this.deliver();
        }
      } catch {}

      if (!this.stopped) {
        this.timer = setTimeout(
          () => {
            this.sending = sending();
          },
          this.broker ? 1000 : 100,
        );
      }
    };

    this.polling = polling();
    this.sending = sending();
  }
  async close() {
    this.stopped = true;
    this.controller.abort();
    clearTimeout(this.timer);
    await Promise.allSettled([this.polling, this.sending]);
    await this.broker?.stop();
  }
}
