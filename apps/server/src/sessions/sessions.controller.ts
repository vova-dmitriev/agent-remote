import { Body, Controller, Get, Inject, Param, Patch, Query, Res, UseGuards } from '@nestjs/common';
import { ErrorCode } from '@protocol';
import type { Response } from 'express';
import type { Principal } from '../auth/security.js';
import { Database } from '../db/database.js';
import { DeviceState } from '../devices/device-state.js';
import { DeviceFence } from '../devices/fence.js';
import { SessionHistory } from '../history/service.js';
import { SourceHistory } from '../history/source.js';
import { CurrentPrincipal } from '../http/auth/current-principal.js';
import { PrincipalGuard } from '../http/auth/principal.guard.js';
import { Fault } from '../http/errors/fault.js';
import { RelayHub } from '../realtime/relay-hub.js';
import { SessionLabels } from './labels.js';

/** Session history pages (from the companion's source when it has one, else the relay's events) and renaming. */
@Controller('sessions/:id')
@UseGuards(PrincipalGuard)
export class SessionsController {
  constructor(
    @Inject(Database) private readonly db: Database,
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

    const page =
      (await sourceHistory.page(p, id, query.before, query.around, query.after, query.position)) ??
      (await history.page(p, id, query.before, query.around, query.after));

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
    const { db, fence, labels } = this;
    const { snapshot } = this.state;
    const { fanout } = this.hub;

    const row = (
      await db.pool.query<{ device_id: string }>(
        'SELECT device_id FROM sessions WHERE owner_id=$1 AND id=$2',
        [p.userId, id],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    return fence.run(row.device_id, async () => {
      const result = await labels.rename(p, id, input);

      fanout(p.userId, row.device_id, await snapshot(p, row.device_id));

      return { title: result.title };
    });
  }
}
