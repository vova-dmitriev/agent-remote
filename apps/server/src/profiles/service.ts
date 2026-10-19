import { AgentProvider, ProfileRequestKind, type ProfileRequest } from '@protocol';
import type { Principal } from '../auth/security.js';
import type { DeviceService } from '../devices/service.js';
import type { ProfileProxy } from './proxy.js';
import type { ProfileConnection } from './types.js';
import type { ProfileMetadataCache } from './repository.js';
import { readProfilePages } from './transport/list.js';

export class ServerProfiles {
  constructor(
    private devices: Pick<DeviceService, 'owned'>,
    private live: Map<string, ProfileConnection>,
    private proxy: ProfileProxy,
    private cache: ProfileMetadataCache,
  ) {}

  async request(
    principal: Principal,
    deviceId: string,
    input: ProfileRequest,
    authKey: string,
    authorize: () => Promise<void>,
    signal: AbortSignal,
  ) {
    await authorize();
    const device = await this.devices.owned(principal, deviceId);

    if (!this.live.has(deviceId) && input.kind === ProfileRequestKind.List) {
      const cached = await this.cache.read(principal.userId, deviceId);

      await authorize();
      await this.devices.owned(principal, deviceId);
      await authorize();

      return {
        kind: ProfileRequestKind.List,
        data: cached ?? {
          available: false,
          observedAt: 0,
          profiles: [],
          operations: [],
          defaults: { [AgentProvider.Claude]: null, [AgentProvider.Codex]: null },
        },
      };
    }

    const send = (request: ProfileRequest) =>
      this.proxy.request(principal, deviceId, request, authKey, authorize, signal);

    const response =
      input.kind === ProfileRequestKind.List ? await readProfilePages(send) : await send(input);

    if (response.kind === ProfileRequestKind.List) {
      await authorize();
      await this.cache.save(principal.userId, deviceId, device.generation, response.data);
    }

    await authorize();
    await this.devices.owned(principal, deviceId);
    await authorize();

    return response;
  }
}
