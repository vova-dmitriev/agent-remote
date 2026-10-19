import { Inject, Injectable } from '@nestjs/common';
import {
  DeviceStatus,
  FrameType,
  snapshotSchema,
  type AppSnapshot,
  type ConnectorDescriptor,
  type Cursor,
} from '@protocol';
import type { Principal } from '../auth/security.js';
import { ContinuityProxy } from '../continuity/proxy.js';
import { HistoryRepository } from '../history/repository.js';
import { Notifier } from '../notifications/notify.js';
import { ProfileProxy } from '../profiles/transport/proxy.js';
import { RelayHub, type DeviceConnection } from '../realtime/relay-hub.js';
import { SessionLabels } from '../sessions/labels.js';
import { DeviceFence } from './fence.js';
import { DeviceService } from './service.js';

export const emptySnapshot = (): AppSnapshot => ({
  sessions: [],
  deviceStatus: DeviceStatus.Offline,
  cursor: { streamId: 'initial', seq: 0 },
  permissions: [],
  terminal: null,
});

/** What an app sees of a device: the current snapshot, the event replay after a cursor and the offline transition. */
@Injectable()
export class DeviceState {
  constructor(
    @Inject(RelayHub) private readonly hub: RelayHub,
    @Inject(HistoryRepository) private readonly history: HistoryRepository,
    @Inject(DeviceService) private readonly devices: DeviceService,
    @Inject(DeviceFence) private readonly fence: DeviceFence,
    @Inject(SessionLabels) private readonly labels: SessionLabels,
    @Inject(ProfileProxy) private readonly profileProxy: ProfileProxy,
    @Inject(ContinuityProxy) private readonly continuityProxy: ContinuityProxy,
    @Inject(Notifier) private readonly notifier: Notifier,
  ) {}

  readonly offline = async (connection: DeviceConnection) => {
    const { hub, fence, profileProxy, continuityProxy } = this;
    const { live, fanout } = hub;
    const { notify } = this.notifier;

    if (hub.closing) {
      return;
    }

    return fence.run(connection.device.id, async () => {
      if (live.get(connection.device.id) !== connection) {
        return;
      }

      live.delete(connection.device.id);
      profileProxy.disconnect(connection);
      continuityProxy.disconnect(connection);

      fanout(connection.device.owner_id, connection.device.id, {
        type: FrameType.DeviceStatus,
        deviceId: connection.device.id,
        status: DeviceStatus.Offline,
      });

      await notify(connection.device.owner_id, 'offline:' + connection.epoch, DeviceStatus.Offline);
    });
  };

  readonly snapshot = async (p: Principal, deviceId: string) => {
    const { devices, labels } = this;
    const { live } = this.hub;
    const device = await devices.owned(p, deviceId);
    const data = device.snapshot ? snapshotSchema.parse(device.snapshot) : emptySnapshot();

    data.sessions = await labels.apply(p, deviceId, data.sessions);
    data.deviceStatus = live.has(deviceId) ? DeviceStatus.Online : DeviceStatus.Offline;

    if (data.deviceStatus === DeviceStatus.Offline) {
      data.permissions = [];
      data.userInputs = [];
      data.terminal = null;
    }

    return {
      type: FrameType.Snapshot,
      deviceId,
      snapshot: data,
      connectors: device.connectors as ConnectorDescriptor[],
    };
  };

  readonly replay = async (p: Principal, deviceId: string, cursor: Cursor) => {
    const { history, devices } = this;

    await devices.owned(p, deviceId);

    const range = await history.streamBounds(p.userId, deviceId, cursor.streamId);

    if (!range?.min || cursor.seq < Number(range.min) - 1 || cursor.seq > Number(range.max)) {
      return FrameType.ResyncRequired;
    }

    return history.after(p.userId, deviceId, cursor.streamId, cursor.seq);
  };
}
