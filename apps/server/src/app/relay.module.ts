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
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { AttachmentRoute } from '../attachments/http/access.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { ContinuityModule } from '../continuity/continuity.module.js';
import { Database } from '../db/database.js';
import { DevicesModule } from '../devices/devices.module.js';
import { PairingController } from '../devices/pairing.controller.js';
import { FaultFilter } from '../http/errors/fault.filter.js';
import type { Messaging } from '../infrastructure/messaging.js';
import { PreferencesController } from '../preferences/preferences.controller.js';
import { PreferenceService } from '../preferences/service.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { ReadingPositionController } from '../reading-position/reading-position.controller.js';
import { ReadingPositionService } from '../reading-position/service.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { CoreModule, type CoreResources } from './core.module.js';
import { HealthController } from '../health/health.controller.js';
import { JsonBodyMiddleware } from '../http/pipeline/middleware.js';
import { MESSAGING, RELAY_CONFIG, type RelayConfig } from './relay-config.js';

// Attachment routes read the raw body themselves (a JSON-typed upload must reach them unparsed) and,
// as before the Nest migration, never pass through the JSON parser.
const RAW_BODY_ROUTES = Object.values(AttachmentRoute).flatMap((path) => [
  { path, method: RequestMethod.POST },
  { path: path + '/:attachmentId', method: RequestMethod.GET },
  { path: path + '/:attachmentId', method: RequestMethod.HEAD },
]);

@Module({})
export class RelayModule implements NestModule, OnModuleInit {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost<ExpressAdapter>,
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
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
        ContinuityModule,
        ProfilesModule,
        AttachmentsModule,
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
  // controllers, static files, 404.
  onModuleInit() {
    if (this.config.staticDirectory) {
      this.adapterHost.httpAdapter.useStaticAssets(this.config.staticDirectory, {});
    }
  }
}
