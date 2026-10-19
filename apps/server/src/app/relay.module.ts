import {
  Inject,
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
  type OnModuleInit,
} from '@nestjs/common';
import { APP_FILTER, HttpAdapterHost } from '@nestjs/core';
import type { ExpressAdapter } from '@nestjs/platform-express';
import { AuthService } from '../auth/auth-service.js';
import { AuthModule } from '../auth/auth.module.js';
import { Limiter } from '../auth/security.js';
import { SessionRevocations } from '../auth/session-revocations.js';
import { Database } from '../db/database.js';
import { DeviceFence } from '../devices/fence.js';
import { PairingController } from '../devices/pairing.controller.js';
import { DeviceService } from '../devices/service.js';
import { FaultFilter } from '../http/fault.filter.js';
import type { Messaging } from '../infrastructure/messaging.js';
import { PreferencesController } from '../preferences/preferences.controller.js';
import { PreferenceService } from '../preferences/service.js';
import { ReadingPositionController } from '../reading-position/reading-position.controller.js';
import { ReadingPositionService } from '../reading-position/service.js';
import { RELAY_RUNTIME, createRelayRuntime, type RelayRuntime } from '../relay-runtime.js';
import { CoreModule, MESSAGING, type CoreResources } from './core.module.js';
import { HealthController } from './health.controller.js';
import { JsonBodyMiddleware } from './middleware.js';
import { RELAY_CONFIG, type RelayConfig } from './relay-config.js';

// Attachment uploads read the raw body themselves; a JSON-typed upload must reach them unparsed.
const RAW_BODY_ROUTES = [
  { path: 'sessions/:sessionId/attachments', method: RequestMethod.POST },
  { path: 'device/sessions/:sessionId/attachments', method: RequestMethod.POST },
];

@Module({})
export class RelayModule implements NestModule, OnModuleInit {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost<ExpressAdapter>,
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(RELAY_RUNTIME) private readonly runtime: RelayRuntime,
  ) {}

  static register(resources: CoreResources): DynamicModule {
    return {
      module: RelayModule,
      imports: [CoreModule.forRoot(resources), AuthModule],
      controllers: [HealthController, PairingController, PreferencesController, ReadingPositionController],
      providers: [
        { provide: APP_FILTER, useClass: FaultFilter },
        {
          provide: PreferenceService,
          inject: [Database, MESSAGING],
          useFactory: (db: Database, messaging: Messaging | undefined) =>
            new PreferenceService(db, messaging?.cache),
        },
        {
          provide: ReadingPositionService,
          inject: [Database, MESSAGING],
          useFactory: (db: Database, messaging: Messaging | undefined) =>
            new ReadingPositionService(db, messaging?.cache),
        },
        {
          provide: RELAY_RUNTIME,
          inject: [
            RELAY_CONFIG,
            Database,
            MESSAGING,
            AuthService,
            DeviceService,
            Limiter,
            DeviceFence,
            SessionRevocations,
          ],
          useFactory: (
            config: RelayConfig,
            db: Database,
            messaging: Messaging | undefined,
            auth: AuthService,
            devices: DeviceService,
            limiter: Limiter,
            fence: DeviceFence,
            revocations: SessionRevocations,
          ) => createRelayRuntime({ config, db, messaging, auth, devices, limiter, fence, revocations }),
        },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(JsonBodyMiddleware)
      .exclude(...RAW_BODY_ROUTES)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }

  // Runs after the controllers are routed and before Nest's 404 handler, so this order holds:
  // controllers, routes not migrated yet, static files, 404.
  onModuleInit() {
    const adapter = this.adapterHost.httpAdapter;

    adapter.use(this.runtime.routes);

    if (this.config.staticDirectory) {
      adapter.useStaticAssets(this.config.staticDirectory, {});
    }
  }
}
