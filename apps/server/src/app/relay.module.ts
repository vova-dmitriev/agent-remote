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
import { AttachmentService } from '../attachments/service.js';
import { AuthService } from '../auth/auth-service.js';
import { AuthModule } from '../auth/auth.module.js';
import { Limiter } from '../auth/security.js';
import { CommandDispatcher } from '../commands/command-dispatcher.js';
import { CommandsModule } from '../commands/commands.module.js';
import { ContinuityProxy } from '../continuity/proxy.js';
import { ContinuityService } from '../continuity/service.js';
import { Database } from '../db/database.js';
import { DevicesModule } from '../devices/devices.module.js';
import { PairingController } from '../devices/pairing.controller.js';
import { DeviceService } from '../devices/service.js';
import { SourceHistory } from '../history/source.js';
import { FaultFilter } from '../http/errors/fault.filter.js';
import type { Messaging } from '../infrastructure/messaging.js';
import { PreferencesController } from '../preferences/preferences.controller.js';
import { PreferenceService } from '../preferences/service.js';
import { ProfileProxy } from '../profiles/proxy.js';
import { ReadingPositionController } from '../reading-position/reading-position.controller.js';
import { ReadingPositionService } from '../reading-position/service.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { RelayHub } from '../realtime/relay-hub.js';
import { RELAY_RUNTIME, createRelayRuntime, type RelayRuntime } from '../relay-runtime.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { CoreModule, type CoreResources } from './core.module.js';
import { HealthController } from '../health/health.controller.js';
import { JsonBodyMiddleware } from '../http/pipeline/middleware.js';
import { MESSAGING, RELAY_CONFIG, type RelayConfig } from './relay-config.js';

// Attachment routes read the raw body themselves (a JSON-typed upload must reach them unparsed) and,
// as before the Nest migration, never pass through the JSON parser.
const RAW_BODY_ROUTES = ['sessions/:sessionId/attachments', 'device/sessions/:sessionId/attachments'].flatMap(
  (path) => [
    { path, method: RequestMethod.POST },
    { path: path + '/:attachmentId', method: RequestMethod.GET },
    { path: path + '/:attachmentId', method: RequestMethod.HEAD },
  ],
);

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
      imports: [
        CoreModule.forRoot(resources),
        AuthModule,
        RealtimeModule,
        DevicesModule,
        SessionsModule,
        CommandsModule,
      ],
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
            AuthService,
            DeviceService,
            Limiter,
            RelayHub,
            AttachmentService,
            ContinuityService,
            SourceHistory,
            ProfileProxy,
            ContinuityProxy,
            CommandDispatcher,
          ],
          useFactory: (
            config: RelayConfig,
            db: Database,
            auth: AuthService,
            devices: DeviceService,
            limiter: Limiter,
            hub: RelayHub,
            attachments: AttachmentService,
            continuity: ContinuityService,
            sourceHistory: SourceHistory,
            profileProxy: ProfileProxy,
            continuityProxy: ContinuityProxy,
            dispatcher: CommandDispatcher,
          ) =>
            createRelayRuntime({
              config,
              db,
              auth,
              devices,
              limiter,
              hub,
              attachments,
              continuity,
              sourceHistory,
              profileProxy,
              continuityProxy,
              dispatcher,
            }),
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
