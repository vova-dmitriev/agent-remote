import { Body, Controller, Get, Inject, Param, Patch, Query, Res, UseGuards } from '@nestjs/common';
import { ErrorCode, HistoryQueryKey } from '@protocol';
import type { Response } from 'express';
import type { Principal } from '../auth/security.js';
import { DeviceState } from '../devices/device-state.js';
import { DeviceFence } from '../devices/fence.js';
import { SessionHistory } from '../history/service.js';
import { SourceHistory } from '../history/source.js';
import { CurrentPrincipal } from '../http/auth/current-principal.js';
import { PrincipalGuard } from '../http/auth/principal.guard.js';
import { Fault } from '../http/errors/fault.js';
import { RelayHub } from '../realtime/relay-hub.js';
import { SessionLabels } from './labels.js';
import { SessionRepository } from './repository.js';

/** Session history pages (from the companion's source when it has one, else the relay's events) and renaming. */
@Controller('sessions/:id')
@UseGuards(PrincipalGuard)
export class SessionsController {
  constructor(
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(DeviceFence) private readonly fence: DeviceFence,
    @Inject(DeviceState) private readonly state: DeviceState,
    @Inject(SessionLabels) private readonly labels: SessionLabels,
    @Inject(SourceHistory) private readonly sourceHistory: SourceHistory,
    @Inject(SessionHistory) private readonly history: SessionHistory,
    @Inject(RelayHub) private readonly hub: RelayHub,
  ) {}

  @Get('events')
  async events(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { sourceHistory, history } = this;

    const agentId = query[HistoryQueryKey.AgentId];

    const source = await sourceHistory.page(
      p,
      id,
      query.before,
      query.around,
      query.after,
      query.position,
      false,
      agentId,
    );

    // Cached events belong to the session itself and never stand in for a subagent's transcript.
    if (!source && agentId !== undefined) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    const page = source ?? (await history.page(p, id, query.before, query.around, query.after));

    if (page.nextCursor) {
      res.setHeader('X-Next-Cursor', page.nextCursor);
    }

    if (page.afterCursor) {
      res.setHeader('X-After-Cursor', page.afterCursor);
    }

    return page.events;
  }

  @Patch()
  async rename(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() input: unknown) {
    const { sessions, fence, labels } = this;
    const { snapshot } = this.state;
    const { fanout } = this.hub;

    const deviceId = await sessions.deviceOf(p.userId, id);

    if (!deviceId) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    return fence.run(deviceId, async () => {
      const result = await labels.rename(p, id, input);

      fanout(p.userId, deviceId, await snapshot(p, deviceId));

      return { title: result.title };
    });
  }
}
