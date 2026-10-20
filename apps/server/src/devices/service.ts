import { ErrorCode } from '@protocol';
import { randomUUID } from 'node:crypto';
import { hash, secret, type Principal } from '../auth/security.js';
import { Fault } from '../http/errors/fault.js';
import { type DeviceRecord, type DeviceRepository } from './repositories/devices.js';
import { type PairingRepository } from './repositories/pairings.js';

export class DeviceService {
  constructor(
    private devices: DeviceRepository,
    private pairings: PairingRepository,
  ) {}
  async owned(p: Principal, id: string): Promise<DeviceRecord> {
    const row = await this.devices.owned(p.userId, id);

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    return row;
  }
  async authenticate(token: string): Promise<DeviceRecord> {
    const row = await this.devices.byToken(hash(token));

    if (!row) {
      throw new Fault(ErrorCode.UNAUTHORIZED);
    }

    return row;
  }
  async list(p: Principal) {
    return this.devices.list(p.userId);
  }
  async start(codeHash: string, proofHash: string) {
    const expiresAt = Date.now() + 300000;

    await this.pairings.deleteExpired(Date.now());
    await this.pairings.insert(codeHash, proofHash, expiresAt);

    return { expiresAt };
  }
  async claim(p: Principal, code: string) {
    const { devices, pairings } = this;

    return devices.transaction(async (tx) => {
      await devices.lockOwner(tx, p.userId);

      if (await devices.hasActive(tx, p.userId)) {
        throw new Fault(ErrorCode.DEVICE_QUOTA);
      }

      const claimId = await pairings.claim(tx, p.userId, randomUUID(), hash(code), Date.now());

      if (!claimId) {
        throw new Fault(ErrorCode.PAIRING_UNAVAILABLE);
      }

      return { claimId };
    });
  }
  async cancel(proof: string) {
    await this.pairings.cancel(hash(proof));

    return {};
  }
  async status(proof: string) {
    const row = await this.pairings.status(hash(proof), Date.now());

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    return { claimId: row.claim_id, telegramId: row.telegram_id, expiresAt: Number(row.expires_at) };
  }
  async confirm(proof: string, claimId: string, approved: boolean) {
    const { devices, pairings } = this;

    return devices.transaction(async (tx) => {
      const ownerId = await pairings.consume(tx, hash(proof), claimId, Date.now());

      if (!ownerId) {
        throw new Fault(ErrorCode.NOT_FOUND);
      }

      if (!approved) {
        return null;
      }

      await devices.lockOwner(tx, ownerId);

      if (await devices.hasActive(tx, ownerId)) {
        throw new Fault(ErrorCode.DEVICE_QUOTA);
      }

      const deviceId = randomUUID(),
        token = secret();

      await devices.insert(tx, deviceId, ownerId, hash(token), randomUUID());

      return { deviceId, token };
    });
  }
  async revoke(p: Principal, id: string) {
    await this.owned(p, id);
    await this.devices.revoke(p.userId, id, Date.now());
  }
}
