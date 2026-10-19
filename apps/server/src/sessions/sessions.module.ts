import { Module } from '@nestjs/common';
import { MESSAGING } from '../app/relay-config.js';
import { Database } from '../db/database.js';
import { DevicesModule } from '../devices/devices.module.js';
import { SessionHistory } from '../history/service.js';
import type { Messaging } from '../infrastructure/messaging.js';
import { SessionsController } from './sessions.controller.js';

@Module({
  imports: [DevicesModule],
  controllers: [SessionsController],
  providers: [
    {
      provide: SessionHistory,
      inject: [Database, MESSAGING],
      useFactory: (db: Database, messaging: Messaging | undefined) =>
        new SessionHistory(db, messaging?.cache),
    },
  ],
})
export class SessionsModule {}
