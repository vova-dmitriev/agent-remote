import { createHash } from 'node:crypto';
import {
  ErrorCode,
  profileQuotaObservationSchema,
  type ProfileQuotaObservation,
  profileRoutingSettingsSchema,
  saveProfileRoutingSchema,
  type SaveProfileRouting,
  type ProfileRoutingSettings,
  profileListSchema,
  ProfileAuthMode,
  ProfileStatus,
  AgentProvider,
} from '@protocol';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Fault } from '../../http/errors/fault.js';
import { ormOn, type Database, type Orm } from '../../db/database.js';
import {
  devices,
  executionProfileMetadata,
  profileQuotaObservations,
  profileRoutingSettings,
} from '../../db/schema/index.js';
import { ProfileRoutingStorage } from './values.js';

const sameDevice = (table: typeof profileRoutingSettings | typeof executionProfileMetadata) =>
  and(eq(table.ownerId, devices.ownerId), eq(table.deviceId, devices.id));

/** A live owned device with its routing settings and profile metadata, if any. */
const liveDevice = (orm: Orm, ownerId: string, deviceId: string, generation?: string) =>
  orm
    .select({
      generation: devices.generation,
      routing: profileRoutingSettings.data,
      metadata: executionProfileMetadata.data,
    })
    .from(devices)
    .leftJoin(profileRoutingSettings, sameDevice(profileRoutingSettings))
    .leftJoin(executionProfileMetadata, sameDevice(executionProfileMetadata))
    .where(
      and(
        eq(devices.ownerId, ownerId),
        eq(devices.id, deviceId),
        isNull(devices.revokedAt),
        generation === undefined ? undefined : eq(devices.generation, generation),
      ),
    );

function empty(ownerId: string, deviceId: string): ProfileRoutingSettings {
  return profileRoutingSettingsSchema.parse({
    ownerId,
    deviceId,
    version: 0,
    defaultPolicyId: null,
    policies: [],
    overrides: [],
  });
}

export class ProfileRoutingRepository {
  constructor(private database: Database) {}

  async get(ownerId: string, deviceId: string) {
    const row = await this.device(ownerId, deviceId);
    const settings = row.routing ? profileRoutingSettingsSchema.parse(row.routing) : empty(ownerId, deviceId);

    const observations = await this.database.orm
      .select({ data: profileQuotaObservations.data })
      .from(profileQuotaObservations)
      .where(
        and(eq(profileQuotaObservations.ownerId, ownerId), eq(profileQuotaObservations.deviceId, deviceId)),
      )
      .orderBy(desc(profileQuotaObservations.observedAt))
      .limit(ProfileRoutingStorage.ObservationLimit);

    return {
      settings,
      observations: observations.map((item) => profileQuotaObservationSchema.parse(item.data)),
    };
  }

  async save(ownerId: string, deviceId: string, generation: string, raw: SaveProfileRouting) {
    const input = saveProfileRoutingSchema.parse(raw);

    return this.database.transaction(async (tx) => {
      const orm = ormOn(tx);
      const [current] = await liveDevice(orm, ownerId, deviceId, generation).for('update', { of: devices });

      if (!current) {
        throw new Fault(ErrorCode.NOT_FOUND);
      }

      const previous = current.routing
        ? profileRoutingSettingsSchema.parse(current.routing)
        : empty(ownerId, deviceId);

      if (previous.version !== input.expectedVersion) {
        throw new Fault(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      this.validateDestinations(input, current.metadata);

      const next = profileRoutingSettingsSchema.parse({
        ownerId,
        deviceId,
        version: previous.version + 1,
        defaultPolicyId: input.defaultPolicyId,
        policies: input.policies,
        overrides: input.overrides,
      });

      await orm
        .insert(profileRoutingSettings)
        .values({ ownerId, deviceId, version: next.version, data: next, updatedAt: Date.now() })
        .onConflictDoUpdate({
          target: [profileRoutingSettings.ownerId, profileRoutingSettings.deviceId],
          set: {
            version: sql`excluded.version`,
            data: sql`excluded.data`,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      return next;
    });
  }

  async recordObservation(
    ownerId: string,
    deviceId: string,
    generation: string,
    raw: ProfileQuotaObservation,
  ) {
    const observation = profileQuotaObservationSchema.parse(raw);

    if (observation.ownerId !== ownerId || observation.deviceId !== deviceId) {
      throw new Fault(ErrorCode.INVALID_DEVICE);
    }

    const scopeKey = createHash('sha256')
      .update(JSON.stringify([observation.scope, observation.poolId ?? null, observation.modelId ?? null]))
      .digest('hex');

    await this.database.transaction(async (tx) => {
      const orm = ormOn(tx);
      const [current] = await liveDevice(orm, ownerId, deviceId, generation).for('update', { of: devices });

      if (!current) {
        throw new Fault(ErrorCode.NOT_FOUND);
      }

      const profile = this.profiles(current.metadata).find((item) => item.id === observation.profileId);

      if (
        !profile ||
        profile.status !== ProfileStatus.Ready ||
        profile.version !== observation.profileVersion ||
        profile.provider !== observation.provider ||
        profile.authMode !== observation.authMode ||
        profile.identity?.accountRef !== observation.accountRef ||
        (observation.workspaceRef !== undefined &&
          profile.identity?.workspaceRef !== observation.workspaceRef)
      ) {
        throw new Fault(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      await orm
        .insert(profileQuotaObservations)
        .values({
          ownerId,
          deviceId,
          profileId: observation.profileId,
          scopeKey,
          observedAt: observation.observedAt,
          data: observation,
        })
        .onConflictDoUpdate({
          target: [
            profileQuotaObservations.ownerId,
            profileQuotaObservations.deviceId,
            profileQuotaObservations.profileId,
            profileQuotaObservations.scopeKey,
          ],
          set: { observedAt: sql`excluded.observed_at`, data: sql`excluded.data` },
          // An older observation never replaces a newer one.
          setWhere: sql`${profileQuotaObservations.observedAt}<=excluded.observed_at`,
        });
    });
  }

  private async device(ownerId: string, deviceId: string) {
    const [row] = await liveDevice(this.database.orm, ownerId, deviceId);

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    return row;
  }

  private validateDestinations(input: SaveProfileRouting, rawMetadata: unknown) {
    const profiles = new Map(this.profiles(rawMetadata).map((profile) => [profile.id, profile]));

    for (const policy of input.policies) {
      for (const rule of policy.rules) {
        const source = profiles.get(rule.sourceProfileId);
        const target = profiles.get(rule.destinationProfileId);

        if (
          !source ||
          !target ||
          source.status !== ProfileStatus.Ready ||
          target.status !== ProfileStatus.Ready ||
          source.version !== rule.sourceProfileVersion ||
          target.version !== rule.destinationProfileVersion ||
          target.provider !== rule.destinationProvider ||
          !target.models.some(
            (model) =>
              model.id === rule.destinationModel &&
              (rule.destinationEffort === undefined || model.efforts.includes(rule.destinationEffort)),
          ) ||
          (rule.sourceModelId !== undefined &&
            !source.models.some((model) => model.id === rule.sourceModelId))
        ) {
          throw new Fault(ErrorCode.PROFILE_NOT_READY);
        }

        if (
          target.authMode === ProfileAuthMode.ApiKey &&
          (!policy.apiSpending.enabled || policy.apiSpending.limitUsd === null)
        ) {
          throw new Fault(ErrorCode.INVALID_REQUEST);
        }
      }
    }
  }

  private profiles(metadata: unknown) {
    return profileListSchema.parse(
      metadata ?? {
        available: false,
        observedAt: 0,
        profiles: [],
        operations: [],
        defaults: { [AgentProvider.Claude]: null, [AgentProvider.Codex]: null },
      },
    ).profiles;
  }
}
