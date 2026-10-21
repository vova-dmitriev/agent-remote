import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ErrorCode, RelayProtocolFeature } from '@protocol';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../../auth/auth-service.js';
import type { Principal } from '../../auth/security.js';
import { CurrentPrincipal } from '../../http/auth/current-principal.js';
import { bearer } from '../../http/auth/bearer.js';
import { PrincipalGuard } from '../../http/auth/principal.guard.js';
import { Fault } from '../../http/errors/fault.js';
import { RelayHub } from '../../realtime/relay-hub.js';
import { DeviceRequests } from '../device-requests.js';
import { SessionRepository } from '../repository.js';

const querySchema = z.strictObject({ generation: z.string().min(1).max(512) });

@Controller('sessions/:id/skills')
@UseGuards(PrincipalGuard)
export class SessionSkillsController {
  constructor(
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(RelayHub) private readonly hub: RelayHub,
    @Inject(DeviceRequests) private readonly requests: DeviceRequests,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: Request,
  ) {
    const { generation } = querySchema.parse(query);
    const session = await this.sessions.live(principal.userId, id);

    if (!session) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    if (session.generation !== generation) {
      throw new Fault(ErrorCode.STALE_SESSION);
    }

    const connection = this.hub.live.get(session.deviceId);

    if (!connection || connection.device.owner_id !== principal.userId) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE);
    }

    if (connection.protocolVersion < RelayProtocolFeature.Skills) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    const result = await this.requests.skills(connection, id, generation);

    await this.auth.authenticate(bearer(request));
    const current = await this.sessions.live(principal.userId, id);

    if (!current || this.hub.live.get(session.deviceId) !== connection) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE);
    }

    if (current.deviceId !== session.deviceId || current.generation !== generation) {
      throw new Fault(ErrorCode.STALE_SESSION);
    }

    return result;
  }
}
