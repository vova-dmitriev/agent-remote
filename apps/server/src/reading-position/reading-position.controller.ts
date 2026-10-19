import { Body, Controller, Get, Inject, Param, Put, UseGuards } from '@nestjs/common';
import type { Principal } from '../auth/security.js';
import { CurrentPrincipal } from '../http/current-principal.js';
import { PrincipalGuard } from '../http/principal.guard.js';
import { ReadingPositionService } from './service.js';

@Controller('sessions/:id/reading-position')
@UseGuards(PrincipalGuard)
export class ReadingPositionController {
  constructor(@Inject(ReadingPositionService) private readonly readingPositions: ReadingPositionService) {}

  @Get()
  async get(@CurrentPrincipal() p: Principal, @Param('id') sessionId: string) {
    return this.readingPositions.get(p, sessionId);
  }

  @Put()
  async update(@CurrentPrincipal() p: Principal, @Param('id') sessionId: string, @Body() input: unknown) {
    return this.readingPositions.update(p, sessionId, input);
  }
}
