import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ProviderFilterValue, SessionListLimits } from '@protocol';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../../auth/auth-service.js';
import type { Principal } from '../../auth/security.js';
import { bearer } from '../../http/auth/bearer.js';
import { CurrentPrincipal } from '../../http/auth/current-principal.js';
import { PrincipalGuard } from '../../http/auth/principal.guard.js';
import { SessionListSource } from './session-list.js';

const pageQuery = z.object({
  provider: z.enum(ProviderFilterValue).default(ProviderFilterValue.All),
  cursor: z.string().max(SessionListLimits.CursorLength).optional(),
});

/** Pages session-list metadata from the owner's live, paired device. */
@Controller('devices/:deviceId/sessions')
@UseGuards(PrincipalGuard)
export class SessionListController {
  constructor(
    @Inject(SessionListSource) private readonly source: SessionListSource,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  async page(
    @CurrentPrincipal() principal: Principal,
    @Param('deviceId') deviceId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
  ) {
    const { provider, cursor } = pageQuery.parse(query);
    const result = await this.source.page(principal, deviceId, provider, cursor);

    await this.auth.authenticate(bearer(request));

    return result;
  }
}
