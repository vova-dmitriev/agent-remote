import { Module } from '@nestjs/common';
import { MESSAGING } from '../app/relay-config.js';
import { DevicesModule } from '../devices/devices.module.js';
import { HistoryRepository } from '../history/repository.js';
import { SessionHistory } from '../history/service.js';
import type { Messaging } from '../infrastructure/messaging.js';
import { SessionsController } from './sessions.controller.js';

@Module({
  imports: [DevicesModule],
  controllers: [SessionsController],
  providers: [
    {
      provide: SessionHistory,
      inject: [HistoryRepository, MESSAGING],
      useFactory: (history: HistoryRepository, messaging: Messaging | undefined) =>
        new SessionHistory(history, messaging?.cache),
    },
  ],
})
export class SessionsModule {}
