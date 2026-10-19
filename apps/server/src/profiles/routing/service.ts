import type { ProfileQuotaObservation, SaveProfileRouting } from '@protocol';
import type { Principal } from '../../auth/security.js';
import type { DeviceService } from '../../devices/service.js';
import { ProfileRoutingRepository } from './repository.js';

export class ProfileRoutingService {
  constructor(
    private devices: Pick<DeviceService, 'owned'>,
    private repository: ProfileRoutingRepository,
  ) {}

  async get(principal: Principal, deviceId: string) {
    await this.devices.owned(principal, deviceId);

    return this.repository.get(principal.userId, deviceId);
  }

  async save(principal: Principal, deviceId: string, input: SaveProfileRouting) {
    const device = await this.devices.owned(principal, deviceId);

    return this.repository.save(principal.userId, deviceId, device.generation, input);
  }

  async recordObservation(
    principal: Principal,
    deviceId: string,
    generation: string,
    observation: ProfileQuotaObservation,
  ) {
    await this.devices.owned(principal, deviceId);
    await this.repository.recordObservation(principal.userId, deviceId, generation, observation);
  }
}
