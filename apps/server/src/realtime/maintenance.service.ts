import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ErrorCode, SocketCloseCode, SocketCloseReason } from '@protocol';
import { MESSAGING } from '../app/relay-config.js';
import { AttachmentRepository } from '../attachments/repositories/attachments.js';
import { AuthService } from '../auth/auth-service.js';
import { CommandRepository } from '../commands/repositories/audit.js';
import { DeviceState } from '../devices/device-state.js';
import { ServerErrorCode } from '../error-codes.js';
import { HistoryRepository } from '../history/repository.js';
import { logWarning } from '../http/errors/error-log.js';
import type { Messaging } from '../infrastructure/messaging.js';
import {
  AUTH_RECHECK_MAX_FAILURES,
  AUTH_RECHECK_MS,
  COMMAND_ACK_SWEEP_MS,
  COMMAND_ACK_TIMEOUT_MS,
  DEVICE_SILENCE_MS,
  MAINTENANCE_TICK_MS,
  RETENTION_INTERVAL_MS,
} from '../maintenance/limits.js';
import { Retention } from '../maintenance/retention.js';
import { RelayHub, type AppConnection } from './relay-hub.js';

const MAINTENANCE_CONTEXT = 'MaintenanceService';

const closeExpired = (client: AppConnection) =>
  client.socket.close(SocketCloseCode.Unauthorized, SocketCloseReason.TokenExpired);

/**
 * Every second, without storage: drops devices silent for 30 s and app sockets whose token expired.
 * Every 5 s, on every relay: marks commands unacknowledged for 15 s as unknown.
 * Every 30 s: re-checks every app socket's token in PostgreSQL, to catch revocations made on another relay;
 * after 3 failed rechecks in a row it closes every app socket rather than trust unverified tokens.
 * Every 60 s: retention deletes, from one shared BullMQ job when Redis is configured, else in this process.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private recheck: ReturnType<typeof setInterval> | undefined;
  private recheckFailures = 0;
  private ackSweep: ReturnType<typeof setInterval> | undefined;
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
          void offline(connection).catch((error: unknown) => logWarning(MAINTENANCE_CONTEXT, error));
        }
      }

      for (const client of clients) {
        if (client.expiresAt <= now) {
          closeExpired(client);
        }
      }
    }, MAINTENANCE_TICK_MS);

    this.timer.unref();

    this.recheck = setInterval(() => void this.recheckTokens(), AUTH_RECHECK_MS);
    this.recheck.unref();

    this.ackSweep = setInterval(
      () =>
        void this.commands
          .expireUnacknowledged(Date.now() - COMMAND_ACK_TIMEOUT_MS)
          .catch((error: unknown) => logWarning(MAINTENANCE_CONTEXT, error)),
      COMMAND_ACK_SWEEP_MS,
    );

    this.ackSweep.unref();

    if (this.messaging) {
      await this.messaging.retention.start(() => retention.run());
    } else {
      this.retention = setInterval(
        () => void retention.run().catch((error: unknown) => logWarning(MAINTENANCE_CONTEXT, error)),
        RETENTION_INTERVAL_MS,
      );

      this.retention.unref();
    }
  }

  /**
   * Closes the sockets whose token was revoked or expired; a stored expiry only ever brings a deadline closer.
   * A failed check is recorded; after `AUTH_RECHECK_MAX_FAILURES` in a row every app socket is closed.
   */
  private async recheckTokens() {
    const clients = [...this.hub.clients];

    // With no socket nothing is trusted, so earlier failures must not count against sockets that connect later.
    if (!clients.length) {
      this.recheckFailures = 0;

      return;
    }

    let unexpired: Map<string, number>;

    try {
      unexpired = await this.auth.unexpired([...new Set(clients.map((client) => client.token))]);
    } catch (error) {
      this.recheckFailures++;
      logWarning(MAINTENANCE_CONTEXT, error, ServerErrorCode.AUTH_RECHECK_FAILED);

      if (this.recheckFailures >= AUTH_RECHECK_MAX_FAILURES) {
        for (const client of this.hub.clients) {
          client.socket.close(SocketCloseCode.TryAgainLater, ErrorCode.SERVICE_UNAVAILABLE);
        }
      }

      return;
    }

    this.recheckFailures = 0;

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
    clearInterval(this.ackSweep);
    clearInterval(this.retention);
    await this.messaging?.retention.stop();
  }
}
