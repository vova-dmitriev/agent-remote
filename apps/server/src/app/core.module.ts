import { Global, Module, type DynamicModule } from '@nestjs/common';
import { AttachmentRepository } from '../attachments/repositories/attachments.js';
import { AttachmentService } from '../attachments/service.js';
import { AuthService } from '../auth/auth-service.js';
import { AuthRepository } from '../auth/repository.js';
import { BrowserSessions } from '../auth/sessions/browser-sessions.js';
import { BrowserSessionRepository } from '../auth/sessions/repository.js';
import { Limiter } from '../auth/security.js';
import { ContinuityService } from '../continuity/service.js';
import { Database } from '../db/database.js';
import { DeviceFence } from '../devices/fence.js';
import { DeviceRepository } from '../devices/repositories/devices.js';
import { PairingRepository } from '../devices/repositories/pairings.js';
import { DeviceService } from '../devices/service.js';
import { HistoryRepository } from '../history/repository.js';
import type { Messaging } from '../infrastructure/messaging.js';
import { Notifier } from '../notifications/notify.js';
import { NotificationRepository } from '../notifications/repositories/notifications.js';
import { SessionLabels } from '../sessions/labels.js';
import { SessionRepository } from '../sessions/repository.js';
import { MESSAGING, RELAY_CONFIG, type RelayConfig } from './relay-config.js';

export interface CoreResources {
  config: RelayConfig;
  db: Database;
  messaging: Messaging | undefined;
}

/** Storage, configuration and the plain domain services every relay module shares. */
@Global()
@Module({})
export class CoreModule {
  static forRoot({ config, db, messaging }: CoreResources): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: RELAY_CONFIG, useValue: config },
        { provide: Database, useValue: db },
        { provide: MESSAGING, useValue: messaging },
        { provide: Limiter, useFactory: () => new Limiter() },
        {
          provide: AuthRepository,
          inject: [Database],
          useFactory: (database: Database) => new AuthRepository(database),
        },
        {
          provide: AuthService,
          inject: [AuthRepository, RELAY_CONFIG],
          useFactory: (auth: AuthRepository, relayConfig: RelayConfig) =>
            new AuthService(auth, relayConfig.botToken),
        },
        {
          provide: DeviceRepository,
          inject: [Database],
          useFactory: (database: Database) => new DeviceRepository(database),
        },
        {
          provide: PairingRepository,
          inject: [Database],
          useFactory: (database: Database) => new PairingRepository(database),
        },
        {
          provide: DeviceService,
          inject: [DeviceRepository, PairingRepository],
          useFactory: (devices: DeviceRepository, pairings: PairingRepository) =>
            new DeviceService(devices, pairings),
        },
        { provide: DeviceFence, useFactory: () => new DeviceFence() },
        {
          provide: BrowserSessionRepository,
          inject: [Database],
          useFactory: (database: Database) => new BrowserSessionRepository(database),
        },
        {
          provide: BrowserSessions,
          inject: [BrowserSessionRepository],
          useFactory: (sessions: BrowserSessionRepository) => new BrowserSessions(sessions),
        },
        {
          provide: HistoryRepository,
          inject: [Database],
          useFactory: (database: Database) => new HistoryRepository(database),
        },
        {
          provide: SessionRepository,
          inject: [Database],
          useFactory: (database: Database) => new SessionRepository(database),
        },
        {
          provide: SessionLabels,
          inject: [SessionRepository],
          useFactory: (sessions: SessionRepository) => new SessionLabels(sessions),
        },
        {
          provide: ContinuityService,
          inject: [Database],
          useFactory: (database: Database) => new ContinuityService(database),
        },
        {
          provide: AttachmentRepository,
          inject: [Database],
          useFactory: (database: Database) => new AttachmentRepository(database),
        },
        {
          provide: AttachmentService,
          inject: [AttachmentRepository],
          useFactory: (attachments: AttachmentRepository) => new AttachmentService(attachments),
        },
        {
          provide: NotificationRepository,
          inject: [Database],
          useFactory: (database: Database) => new NotificationRepository(database),
        },
        Notifier,
      ],
      exports: [
        RELAY_CONFIG,
        Database,
        MESSAGING,
        Limiter,
        AuthService,
        DeviceRepository,
        DeviceService,
        DeviceFence,
        BrowserSessions,
        HistoryRepository,
        SessionRepository,
        SessionLabels,
        ContinuityService,
        AttachmentRepository,
        AttachmentService,
        Notifier,
      ],
    };
  }
}
