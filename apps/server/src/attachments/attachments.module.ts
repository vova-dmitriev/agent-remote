import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { AttachmentAccess, AttachmentRoute } from './http/access.js';
import { AttachmentsController } from './http/attachments.controller.js';
import { AttachmentUploadMiddleware } from './http/upload.middleware.js';

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentAccess],
})
export class AttachmentsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AttachmentUploadMiddleware)
      .forRoutes(...Object.values(AttachmentRoute).map((path) => ({ path, method: RequestMethod.POST })));
  }
}
