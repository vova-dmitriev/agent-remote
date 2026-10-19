import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CommandStatus, ErrorCode, SocketCloseCode, SocketCloseReason } from '@protocol';
import { AttachmentService } from '../attachments/service.js';
import { AuthService } from '../auth/auth-service.js';
import { Database } from '../db/database.js';
import { DeviceState } from '../devices/device-state.js';
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
    @Inject(Database) private readonly db: Database,
  ) {}

  onModuleInit() {
    const { auth, attachments, db } = this;
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

      void db.pool
        .query(
          'DELETE FROM events WHERE occurred_at<$1 OR ctid IN (SELECT ctid FROM (SELECT ctid,row_number() OVER(PARTITION BY device_id ORDER BY occurred_at DESC) AS rank FROM events) e WHERE rank>10000)',
          [Date.now() - 86400000],
        )
        .catch(() => {});

      void db.pool
        .query('UPDATE command_audit SET status=$2,code=$3 WHERE status=$4 AND created_at<$1', [
          Date.now() - 15000,
          CommandStatus.Unknown,
          ErrorCode.ACK_TIMEOUT,
          CommandStatus.Accepted,
        ])
        .catch(() => {});

      void db.pool
        .query('DELETE FROM command_audit WHERE created_at<$1', [Date.now() - 86400000])
        .catch(() => {});
    }, 10000);

    this.retention.unref();
  }

  // `app.close()` calls this before it closes the HTTP server, so no maintenance tick runs during shutdown.
  onModuleDestroy() {
    clearInterval(this.timer);
    clearInterval(this.retention);
  }
}
