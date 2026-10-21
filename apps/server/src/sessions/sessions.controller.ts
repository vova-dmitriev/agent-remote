import { Body, Controller, Get, Inject, Param, Patch, Put, Query, Res, UseGuards } from '@nestjs/common';
import {
  ErrorCode,
  FrameType,
  HistoryQueryKey,
  RelayProtocolFeature,
  sessionFileQuerySchema,
  sessionPinSchema,
} from '@protocol';
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
import { DeviceRequests } from './device-requests.js';
import { SessionLabels } from './labels.js';
import { SessionRepository } from './repository.js';

/**
 * Session history pages (from the companion's source when it has one, else the relay's events), renaming, pins and
 * the files a session changed.
 */
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
    @Inject(DeviceRequests) private readonly requests: DeviceRequests,
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

    // A live device that speaks renames names the session in its agent; its next snapshot carries the name back.
    const renamer = (device: string) => {
      const connection = this.hub.live.get(device);

      return connection?.device.owner_id === p.userId &&
        connection.protocolVersion >= RelayProtocolFeature.SessionRename
        ? connection
        : undefined;
    };

    return fence.run(deviceId, async () => {
      let result = await labels.rename(p, id, input, (device) => renamer(device) !== undefined);
      const connection = result.inAgent ? renamer(result.deviceId) : undefined;

      if (
        result.inAgent &&
        !(
          connection &&
          this.hub.send(connection.socket, {
            type: FrameType.SessionRename,
            sessionId: id,
            title: result.title,
          })
        )
      ) {
        // The device went away after the check: keep the name as the relay's label instead.
        result = await labels.rename(p, id, input);
      }

      fanout(p.userId, deviceId, await snapshot(p, deviceId));

      return { title: result.title };
    });
  }

  /**
   * Pins or unpins an owned session. The device keeps pins, so the change goes to its live connection and comes
   * back in its next snapshot; an offline device, or one too old for pins, cannot take it.
   */
  @Put('pin')
  async pin(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() input: unknown) {
    const body = sessionPinSchema.parse(input);
    const session = await this.sessions.live(p.userId, id);

    if (!session) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    if (session.generation !== body.generation) {
      throw new Fault(ErrorCode.STALE_SESSION);
    }

    const connection = this.hub.live.get(session.deviceId);

    if (!connection || connection.device.owner_id !== p.userId) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE);
    }

    if (connection.protocolVersion < RelayProtocolFeature.SessionPins) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    if (
      !this.hub.send(connection.socket, { type: FrameType.SessionPin, sessionId: id, pinned: body.pinned })
    ) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE);
    }

    return { pinned: body.pinned };
  }

  /**
   * The text of a file the session changed, read on its live device. The device reads only paths in the session's
   * own change list; an offline device, or one too old to read files, cannot answer.
   */
  @Get('file')
  async file(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Query() query: unknown) {
    const { path } = sessionFileQuerySchema.parse(query);
    const session = await this.sessions.live(p.userId, id);

    if (!session) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    const connection = this.hub.live.get(session.deviceId);

    if (!connection || connection.device.owner_id !== p.userId) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE);
    }

    if (connection.protocolVersion < RelayProtocolFeature.SessionFiles) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    return this.requests.read(connection, id, path);
  }
}
