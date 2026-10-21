import { Global, Inject, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { ExpressAdapter } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { ContinuityProxy } from '../continuity/proxy.js';
import { DevicesModule } from '../devices/devices.module.js';
import { DeviceService } from '../devices/service.js';
import { HistoryRepository } from '../history/repository.js';
import { SourceHistory } from '../history/source.js';
import { ProfileProxy } from '../profiles/transport/proxy.js';
import { Database } from '../db/database.js';
import { SessionRepository } from '../sessions/repository.js';
import { SessionCatalogRepository } from '../sessions/catalog/session-catalog-repository.js';
import { SessionListSource } from '../sessions/catalog/session-list.js';
import { SessionLabels } from '../sessions/labels.js';
import { DeviceRequests } from '../sessions/device-requests.js';
import { AppSocket } from './app-socket.js';
import { DeviceSocket } from './device-socket.js';
import { MaintenanceService } from './maintenance.service.js';
import { RelayHub } from './relay-hub.js';

/**
 * WebSocket hub, socket handlers and maintenance jobs.
 * Global so the device, session and command modules can use the hub while the socket handlers here use their services.
 */
@Global()
@Module({
  imports: [AuthModule, DevicesModule, CommandsModule],
  providers: [
    RelayHub,
    {
      provide: SourceHistory,
      inject: [HistoryRepository, RelayHub],
      useFactory: (history: HistoryRepository, hub: RelayHub) =>
        new SourceHistory(history, hub.live, hub.send),
    },
    {
      provide: ProfileProxy,
      inject: [DeviceService, RelayHub],
      useFactory: (devices: DeviceService, hub: RelayHub) => new ProfileProxy(devices, hub.live, hub.send),
    },
    {
      provide: ContinuityProxy,
      inject: [DeviceService, RelayHub],
      useFactory: (devices: DeviceService, hub: RelayHub) => new ContinuityProxy(devices, hub.live, hub.send),
    },
    {
      provide: DeviceRequests,
      inject: [RelayHub],
      useFactory: (hub: RelayHub) => new DeviceRequests(hub.send),
    },
    {
      provide: SessionListSource,
      inject: [SessionRepository, Database, RelayHub, SessionLabels],
      useFactory: (sessions: SessionRepository, db: Database, hub: RelayHub, labels: SessionLabels) =>
        new SessionListSource(sessions, new SessionCatalogRepository(db), hub, labels),
    },
    AppSocket,
    DeviceSocket,
    MaintenanceService,
  ],
  exports: [RelayHub, SourceHistory, ProfileProxy, ContinuityProxy, DeviceRequests, SessionListSource],
})
export class RealtimeModule implements OnApplicationBootstrap {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost<ExpressAdapter>,
    @Inject(RelayHub) private readonly hub: RelayHub,
    @Inject(AppSocket) private readonly appSocket: AppSocket,
    @Inject(DeviceSocket) private readonly deviceSocket: DeviceSocket,
  ) {}

  onApplicationBootstrap() {
    this.hub.appWss.on('connection', this.appSocket.connect);
    this.hub.deviceWss.on('connection', this.deviceSocket.connect);
    this.hub.attach(this.adapterHost.httpAdapter.getHttpServer());
  }
}
