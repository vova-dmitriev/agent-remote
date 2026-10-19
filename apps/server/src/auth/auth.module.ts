import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { SessionRevocations } from './sessions/session-revocations.js';

@Module({
  controllers: [AuthController],
  providers: [{ provide: SessionRevocations, useFactory: () => new SessionRevocations() }],
  exports: [SessionRevocations],
})
export class AuthModule {}
