import { ErrorCode, profileListSchema, type ProfileList } from '@protocol';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Fault } from '../http/errors/fault.js';
import type { Database } from '../db/database.js';
import { devices, executionProfileMetadata } from '../db/schema/index.js';

export class ProfileMetadataCache {
  constructor(private database: Database) {}

  async read(ownerId: string, deviceId: string): Promise<ProfileList | null> {
    const [row] = await this.database.orm
      .select({ data: executionProfileMetadata.data })
      .from(devices)
      .leftJoin(
        executionProfileMetadata,
        and(
          eq(executionProfileMetadata.ownerId, devices.ownerId),
          eq(executionProfileMetadata.deviceId, devices.id),
        ),
      )
      .where(and(eq(devices.ownerId, ownerId), eq(devices.id, deviceId), isNull(devices.revokedAt)));

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    if (!row.data) {
      return null;
    }

    return { ...profileListSchema.parse(row.data), available: false };
  }

  /** Stores the list only for the owner's live device at this generation. */
  async save(ownerId: string, deviceId: string, generation: string, input: ProfileList) {
    const data = profileListSchema.parse(input);

    if ([...data.profiles, ...data.operations].some((value) => value.deviceId !== deviceId)) {
      throw new Fault(ErrorCode.INVALID_DEVICE);
    }

    const orm = this.database.orm;

    const saved = await orm
      .insert(executionProfileMetadata)
      .select(
        orm
          .select({
            ownerId: devices.ownerId,
            deviceId: devices.id,
            data: sql`${JSON.stringify(data)}::jsonb`.as('data'),
          })
          .from(devices)
          .where(
            and(
              eq(devices.ownerId, ownerId),
              eq(devices.id, deviceId),
              eq(devices.generation, generation),
              isNull(devices.revokedAt),
            ),
          ),
      )
      .onConflictDoUpdate({
        target: [executionProfileMetadata.ownerId, executionProfileMetadata.deviceId],
        set: { data: sql`excluded.data` },
      })
      .returning({ ownerId: executionProfileMetadata.ownerId });

    if (!saved.length) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }
  }
}
