import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SocketCloseCode, SocketCloseReason } from '@protocol';
import { AttachmentService } from '../attachments/service.js';
import { AuthService } from '../auth/auth-service.js';
import { CommandRepository } from '../commands/repositories/audit.js';
import { DeviceState } from '../devices/device-state.js';
import { HistoryRepository } from '../history/repository.js';
import { RelayHub } from './relay-hub.js';

/**
 * Every second: drops devices silent for 30 s and app sockets whose token expired.
 * Every 10 s: prunes attachments, old events and command audit, and times out unacknowledged commands.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private retention: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(RelayHub) private readonly hub: RelayHub,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DeviceState) private readonly state: DeviceState,
    @Inject(AttachmentService) private readonly attachments: AttachmentService,
    @Inject(HistoryRepository) private readonly history: HistoryRepository,
    @Inject(CommandRepository) private readonly commands: CommandRepository,
  ) {}

  onModuleInit() {
    const { auth, attachments, history, commands } = this;
    const { live, clients } = this.hub;
    const { offline } = this.state;

    this.timer = setInterval(() => {
      for (const connection of live.values()) {
        if (connection.lastSeen < Date.now() - 30000) {
          connection.socket.close(SocketCloseCode.Offline, SocketCloseReason.Offline);
          void offline(connection).catch(() => {});
        }
      }

      for (const client of clients) {
        void auth
          .authenticate(client.token)
          .catch(() => client.socket.close(SocketCloseCode.Unauthorized, SocketCloseReason.TokenExpired));
      }
    }, 1000);

    this.timer.unref();

    this.retention = setInterval(() => {
      void attachments.prune().catch(() => {});

      void history.prune(Date.now() - 86400000).catch(() => {});
      void commands.expireUnacknowledged(Date.now() - 15000).catch(() => {});
      void commands.prune(Date.now() - 86400000).catch(() => {});
    }, 10000);

    this.retention.unref();
  }

  // `app.close()` calls this before it closes the HTTP server, so no maintenance tick runs during shutdown.
  onModuleDestroy() {
    clearInterval(this.timer);
    clearInterval(this.retention);
  }
}
