import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  analyticsQuerySchema,
  HttpStatus,
  projectSessionSchema,
  rulesRequestSchema,
  DeviceStatus,
  ErrorCode,
  FrameType,
  RelayProtocolFeature,
  SocketCloseCode,
  SocketCloseReason,
} from '@protocol';
import { z } from 'zod';
import type { Principal } from '../auth/security.js';
import { ContinuityProxy } from '../continuity/proxy.js';
import { CurrentPrincipal } from '../http/auth/current-principal.js';
import { PrincipalGuard } from '../http/auth/principal.guard.js';
import { Fault } from '../http/errors/fault.js';
import { ProfileProxy } from '../profiles/transport/proxy.js';
import { RelayHub } from '../realtime/relay-hub.js';
import { DeviceRequests } from '../sessions/device-requests.js';
import { DeviceState } from './device-state.js';
import { DeviceFence } from './fence.js';
import { DeviceService } from './service.js';

const boundedId = z.string().min(1).max(512);

/** The signed-in user's paired devices: list, revoke, snapshot, connectors and event replay. */
@Controller('devices')
@UseGuards(PrincipalGuard)
export class DevicesController {
  constructor(
    @Inject(DeviceService) private readonly devices: DeviceService,
    @Inject(DeviceFence) private readonly fence: DeviceFence,
    @Inject(DeviceState) private readonly state: DeviceState,
    @Inject(RelayHub) private readonly hub: RelayHub,
    @Inject(ProfileProxy) private readonly profileProxy: ProfileProxy,
    @Inject(ContinuityProxy) private readonly continuityProxy: ContinuityProxy,
    @Inject(DeviceRequests) private readonly requests: DeviceRequests,
  ) {}

  @Get()
  async list(@CurrentPrincipal() p: Principal) {
    return this.devices.list(p);
  }

  @Delete(':id')
  async revoke(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    const { devices, fence, profileProxy, continuityProxy } = this;
    const { live, fanout } = this.hub;

    return fence.run(id, async () => {
      await devices.revoke(p, id);
      const connection = live.get(id);

      if (connection) {
        live.delete(id);
        profileProxy.disconnect(connection);
        continuityProxy.disconnect(connection);
        connection.socket.close(SocketCloseCode.Revoked, SocketCloseReason.Revoked);
      }

      fanout(p.userId, id, { type: FrameType.DeviceStatus, deviceId: id, status: DeviceStatus.Offline });

      return {};
    });
  }

  @Get(':id/snapshot')
  async snapshot(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.state.snapshot(p, id);
  }

  @Get(':id/connectors')
  async connectors(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return (await this.devices.owned(p, id)).connectors;
  }

  /** The device's token usage, computed on the Mac; an offline device, or one too old to keep it, cannot answer. */
  @Get(':id/analytics')
  async analytics(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Query() query: unknown) {
    const { period } = analyticsQuerySchema.parse(query);

    return this.requests.analytics(await this.liveDevice(p, id, RelayProtocolFeature.Analytics), period);
  }

  /** The owner's live connection to the device, if it speaks the feature: else offline or unavailable. */
  private async liveDevice(p: Principal, id: string, feature: number) {
    await this.devices.owned(p, id);

    const connection = this.hub.live.get(id);

    if (!connection || connection.device.owner_id !== p.userId) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE);
    }

    if (connection.protocolVersion < feature) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    return connection;
  }

  /** Lists or changes the owner's rules for the agents on the device; the device keeps them. */
  @Post(':id/rules')
  async rules(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    const request = rulesRequestSchema.parse(body);

    return this.requests.rules(await this.liveDevice(p, id, RelayProtocolFeature.Rules), request);
  }

  /**
   * Starts a session in one of the device's projects, for an owner with no session there yet (a shared VM); the
   * device answers with the new session's id once it runs.
   */
  @Post(':id/sessions')
  @HttpCode(HttpStatus.Ok)
  async createSession(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    const session = projectSessionSchema.parse(body);

    return {
      sessionId: await this.requests.createSession(
        await this.liveDevice(p, id, RelayProtocolFeature.ProjectSessions),
        session,
      ),
    };
  }

  @Get(':id/events')
  async events(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Query('streamId') streamId: unknown,
    @Query('seq') seq: unknown,
  ) {
    return this.state.replay(p, id, {
      streamId: boundedId.parse(streamId),
      seq: z.coerce.number().int().nonnegative().parse(seq),
    });
  }
}
