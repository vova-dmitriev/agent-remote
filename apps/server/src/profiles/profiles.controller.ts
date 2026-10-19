import { Body, Controller, HttpCode, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ErrorCode, HttpStatus, ProfileRequestKind, profileRequestSchema } from '@protocol';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { RELAY_CONFIG, type RelayConfig } from '../app/relay-config.js';
import { AuthService } from '../auth/auth-service.js';
import { Limiter, RateLimitKey, hash, type Principal } from '../auth/security.js';
import { bearer } from '../http/auth/bearer.js';
import { CurrentPrincipal } from '../http/auth/current-principal.js';
import { PrincipalGuard } from '../http/auth/principal.guard.js';
import { Fault } from '../http/errors/fault.js';
import { ServerProfiles } from './service.js';

const PROFILE_REQUESTS_PER_WINDOW = 120;
const boundedId = z.string().min(1).max(512);

/** Execution-profile requests answered by the device's companion, or by the cached list while it is offline. */
@Controller('devices/:deviceId/profiles')
@UseGuards(PrincipalGuard)
export class ProfilesController {
  constructor(
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Limiter) private readonly limiter: Limiter,
    @Inject(ServerProfiles) private readonly profiles: ServerProfiles,
  ) {}

  @Post()
  @HttpCode(HttpStatus.Ok)
  async request(
    @CurrentPrincipal() p: Principal,
    @Param('deviceId') rawDeviceId: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = bearer(req);
    const deviceId = boundedId.parse(rawDeviceId);

    this.limiter.take(RateLimitKey.Profiles + p.userId, PROFILE_REQUESTS_PER_WINDOW);
    const request = profileRequestSchema.parse(body);

    if (
      !this.config.inputEnabled &&
      request.kind !== ProfileRequestKind.List &&
      request.kind !== ProfileRequestKind.Operation
    ) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    // A client that disconnects cancels the request it was waiting for.
    const controller = new AbortController();

    const cancel = () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    };

    res.once('close', cancel);

    try {
      return await this.profiles.request(
        p,
        deviceId,
        request,
        hash(token),
        async () => {
          await this.auth.authenticate(token);
        },
        controller.signal,
      );
    } finally {
      res.off('close', cancel);
    }
  }
}
