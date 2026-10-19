import { Global, Module, type DynamicModule } from '@nestjs/common';
import { AuthService } from '../auth/auth-service.js';
import { BrowserSessions } from '../auth/sessions/browser-sessions.js';
import { Limiter } from '../auth/security.js';
import { Database } from '../db/database.js';
import { DeviceFence } from '../devices/fence.js';
import { DeviceService } from '../devices/service.js';
import type { Messaging } from '../infrastructure/messaging.js';
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
          provide: AuthService,
          inject: [Database, RELAY_CONFIG],
          useFactory: (database: Database, relayConfig: RelayConfig) =>
            new AuthService(database, relayConfig.botToken),
        },
        {
          provide: DeviceService,
          inject: [Database],
          useFactory: (database: Database) => new DeviceService(database),
        },
        { provide: DeviceFence, useFactory: () => new DeviceFence() },
        {
          provide: BrowserSessions,
          inject: [Database],
          useFactory: (database: Database) => new BrowserSessions(database),
        },
      ],
      exports: [
        RELAY_CONFIG,
        Database,
        MESSAGING,
        Limiter,
        AuthService,
        DeviceService,
        DeviceFence,
        BrowserSessions,
      ],
    };
  }
}
