import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SocketCloseCode, SocketCloseReason } from '@protocol';
import { MESSAGING } from '../app/relay-config.js';
import { AttachmentRepository } from '../attachments/repositories/attachments.js';
import { AuthService } from '../auth/auth-service.js';
import { CommandRepository } from '../commands/repositories/audit.js';
import { DeviceState } from '../devices/device-state.js';
import { HistoryRepository } from '../history/repository.js';
import type { Messaging } from '../infrastructure/messaging.js';
import {
  AUTH_RECHECK_MS,
  DEVICE_SILENCE_MS,
  MAINTENANCE_TICK_MS,
  RETENTION_INTERVAL_MS,
} from '../maintenance/limits.js';
import { Retention } from '../maintenance/retention.js';
import { RelayHub, type AppConnection } from './relay-hub.js';

const closeExpired = (client: AppConnection) =>
  client.socket.close(SocketCloseCode.Unauthorized, SocketCloseReason.TokenExpired);

/**
 * Every second, without storage: drops devices silent for 30 s and app sockets whose token expired.
 * Every 30 s: one query re-checks every app socket's token, to catch revocations made on another relay.
 * Every 60 s: retention, from one shared BullMQ job when Redis is configured, else in this process.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private recheck: ReturnType<typeof setInterval> | undefined;
  private retention: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(RelayHub) private readonly hub: RelayHub,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DeviceState) private readonly state: DeviceState,
    @Inject(HistoryRepository) private readonly history: HistoryRepository,
    @Inject(CommandRepository) private readonly commands: CommandRepository,
    @Inject(AttachmentRepository) private readonly attachments: AttachmentRepository,
    @Inject(MESSAGING) private readonly messaging: Messaging | undefined,
  ) {}

  async onModuleInit() {
    const { live, clients } = this.hub;
    const { offline } = this.state;
    const retention = new Retention(this.history, this.commands, this.attachments);

    this.timer = setInterval(() => {
      const now = Date.now();

      for (const connection of live.values()) {
        if (connection.lastSeen < now - DEVICE_SILENCE_MS) {
          connection.socket.close(SocketCloseCode.Offline, SocketCloseReason.Offline);
          void offline(connection).catch(() => {});
        }
      }

      for (const client of clients) {
        if (client.expiresAt <= now) {
          closeExpired(client);
        }
      }
    }, MAINTENANCE_TICK_MS);

    this.timer.unref();

    this.recheck = setInterval(() => void this.recheckTokens().catch(() => {}), AUTH_RECHECK_MS);
    this.recheck.unref();

    if (this.messaging) {
      await this.messaging.retention.start(() => retention.run());
    } else {
      this.retention = setInterval(() => void retention.run().catch(() => {}), RETENTION_INTERVAL_MS);
      this.retention.unref();
    }
  }

  /** Closes the sockets whose token was revoked or expired; a stored expiry only ever brings a deadline closer. */
  private async recheckTokens() {
    const clients = [...this.hub.clients];

    if (!clients.length) {
      return;
    }

    const unexpired = await this.auth.unexpired([...new Set(clients.map((client) => client.token))]);

    for (const client of clients) {
      const expiresAt = unexpired.get(client.token);

      if (expiresAt === undefined) {
        closeExpired(client);
      } else {
        client.expiresAt = Math.min(client.expiresAt, expiresAt);
      }
    }
  }

  // `app.close()` calls this before it closes the HTTP server, so no maintenance tick runs during shutdown.
  async onModuleDestroy() {
    clearInterval(this.timer);
    clearInterval(this.recheck);
    clearInterval(this.retention);
    await this.messaging?.retention.stop();
  }
}
