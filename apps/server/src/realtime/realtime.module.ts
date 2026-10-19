import { Global, Inject, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { ExpressAdapter } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { ContinuityProxy } from '../continuity/proxy.js';
import { Database } from '../db/database.js';
import { DevicesModule } from '../devices/devices.module.js';
import { DeviceService } from '../devices/service.js';
import { SourceHistory } from '../history/source.js';
import { ProfileProxy } from '../profiles/proxy.js';
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
      inject: [Database, RelayHub],
      useFactory: (db: Database, hub: RelayHub) => new SourceHistory(db, hub.live, hub.send),
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
    AppSocket,
    DeviceSocket,
    MaintenanceService,
  ],
  exports: [RelayHub, SourceHistory, ProfileProxy, ContinuityProxy],
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
