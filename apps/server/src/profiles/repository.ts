import { ErrorCode, profileListSchema, type ProfileList } from '@protocol';
import { Fault } from '../auth/security.js';
import type { Database } from '../db/database.js';

export class ProfileMetadataCache {
  constructor(private database: Database) {}

  async read(ownerId: string, deviceId: string): Promise<ProfileList | null> {
    const row = (
      await this.database.pool.query<{ data: unknown }>(
        'SELECT p.data FROM devices d LEFT JOIN execution_profile_metadata p ON p.owner_id=d.owner_id AND p.device_id=d.id WHERE d.owner_id=$1 AND d.id=$2 AND d.revoked_at IS NULL',
        [ownerId, deviceId],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND, 404);
    }

    if (!row.data) {
      return null;
    }

    return { ...profileListSchema.parse(row.data), available: false };
  }

  async save(ownerId: string, deviceId: string, generation: string, input: ProfileList) {
    const data = profileListSchema.parse(input);

    if ([...data.profiles, ...data.operations].some((value) => value.deviceId !== deviceId)) {
      throw new Fault(ErrorCode.INVALID_DEVICE, 409);
    }

    const result = await this.database.pool.query(
      'INSERT INTO execution_profile_metadata(owner_id,device_id,data) SELECT owner_id,id,$4 FROM devices WHERE owner_id=$1 AND id=$2 AND generation=$3 AND revoked_at IS NULL ON CONFLICT(owner_id,device_id) DO UPDATE SET data=EXCLUDED.data',
      [ownerId, deviceId, generation, JSON.stringify(data)],
    );

    if (!result.rowCount) {
      throw new Fault(ErrorCode.NOT_FOUND, 404);
    }
  }
}
