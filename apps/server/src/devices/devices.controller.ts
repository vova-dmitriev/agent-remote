import { Controller, Delete, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import {
  analyticsQuerySchema,
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

    await this.devices.owned(p, id);

    const connection = this.hub.live.get(id);

    if (!connection || connection.device.owner_id !== p.userId) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE);
    }

    if (connection.protocolVersion < RelayProtocolFeature.Analytics) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    return this.requests.analytics(connection, period);
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
