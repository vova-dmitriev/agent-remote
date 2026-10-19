import { Module } from '@nestjs/common';
import { Database } from '../db/database.js';
import { DeviceService } from '../devices/service.js';
import { RelayHub } from '../realtime/relay-hub.js';
import { ProfilesController } from './profiles.controller.js';
import { ProfileMetadataCache } from './repository.js';
import { ServerProfiles } from './service.js';
import { ProfileProxy } from './transport/proxy.js';

@Module({
  controllers: [ProfilesController],
  providers: [
    {
      provide: ServerProfiles,
      inject: [DeviceService, RelayHub, ProfileProxy, Database],
      useFactory: (devices: DeviceService, hub: RelayHub, proxy: ProfileProxy, db: Database) =>
        new ServerProfiles(devices, hub.live, proxy, new ProfileMetadataCache(db)),
    },
  ],
})
export class ProfilesModule {}
