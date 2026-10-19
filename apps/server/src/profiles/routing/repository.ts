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
import { Fault } from '../../auth/security.js';
import type { Database } from '../../db/database.js';
import { ProfileRoutingStorage } from './values.js';

interface DeviceRow {
  generation: string;
  routing: unknown;
  metadata: unknown;
}

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

    const observations = await this.database.pool.query<{ data: unknown }>(
      'SELECT data FROM profile_quota_observations WHERE owner_id=$1 AND device_id=$2 ORDER BY observed_at DESC LIMIT $3',
      [ownerId, deviceId, ProfileRoutingStorage.ObservationLimit],
    );

    return {
      settings,
      observations: observations.rows.map((item) => profileQuotaObservationSchema.parse(item.data)),
    };
  }

  async save(ownerId: string, deviceId: string, generation: string, raw: SaveProfileRouting) {
    const input = saveProfileRoutingSchema.parse(raw);

    return this.database.transaction(async (tx) => {
      const row = await tx.query<DeviceRow>(
        'SELECT d.generation,r.data AS routing,p.data AS metadata FROM devices d LEFT JOIN profile_routing_settings r ON r.owner_id=d.owner_id AND r.device_id=d.id LEFT JOIN execution_profile_metadata p ON p.owner_id=d.owner_id AND p.device_id=d.id WHERE d.owner_id=$1 AND d.id=$2 AND d.generation=$3 AND d.revoked_at IS NULL FOR UPDATE OF d',
        [ownerId, deviceId, generation],
      );

      const current = row.rows[0];

      if (!current) {
        throw new Fault(ErrorCode.NOT_FOUND, 404);
      }

      const previous = current.routing
        ? profileRoutingSettingsSchema.parse(current.routing)
        : empty(ownerId, deviceId);

      if (previous.version !== input.expectedVersion) {
        throw new Fault(ErrorCode.LOCAL_REVISION_CONFLICT, 409);
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

      await tx.query(
        'INSERT INTO profile_routing_settings(owner_id,device_id,version,data,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,device_id) DO UPDATE SET version=EXCLUDED.version,data=EXCLUDED.data,updated_at=EXCLUDED.updated_at',
        [ownerId, deviceId, next.version, JSON.stringify(next), Date.now()],
      );

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
      throw new Fault(ErrorCode.INVALID_DEVICE, 409);
    }

    const scopeKey = createHash('sha256')
      .update(JSON.stringify([observation.scope, observation.poolId ?? null, observation.modelId ?? null]))
      .digest('hex');

    await this.database.transaction(async (tx) => {
      const row = await tx.query<DeviceRow>(
        'SELECT d.generation,p.data AS metadata FROM devices d LEFT JOIN execution_profile_metadata p ON p.owner_id=d.owner_id AND p.device_id=d.id WHERE d.owner_id=$1 AND d.id=$2 AND d.generation=$3 AND d.revoked_at IS NULL FOR UPDATE OF d',
        [ownerId, deviceId, generation],
      );

      if (!row.rows[0]) {
        throw new Fault(ErrorCode.NOT_FOUND, 404);
      }

      const profile = this.profiles(row.rows[0].metadata).find((item) => item.id === observation.profileId);

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
        throw new Fault(ErrorCode.LOCAL_REVISION_CONFLICT, 409);
      }

      await tx.query(
        'INSERT INTO profile_quota_observations(owner_id,device_id,profile_id,scope_key,observed_at,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,device_id,profile_id,scope_key) DO UPDATE SET observed_at=EXCLUDED.observed_at,data=EXCLUDED.data WHERE profile_quota_observations.observed_at<=EXCLUDED.observed_at',
        [
          ownerId,
          deviceId,
          observation.profileId,
          scopeKey,
          observation.observedAt,
          JSON.stringify(observation),
        ],
      );
    });
  }

  private async device(ownerId: string, deviceId: string, generation?: string): Promise<DeviceRow> {
    const result = await this.database.pool.query<DeviceRow>(
      'SELECT d.generation,r.data AS routing,p.data AS metadata FROM devices d LEFT JOIN profile_routing_settings r ON r.owner_id=d.owner_id AND r.device_id=d.id LEFT JOIN execution_profile_metadata p ON p.owner_id=d.owner_id AND p.device_id=d.id WHERE d.owner_id=$1 AND d.id=$2 AND d.revoked_at IS NULL AND ($3::text IS NULL OR d.generation=$3)',
      [ownerId, deviceId, generation ?? null],
    );

    if (!result.rows[0]) {
      throw new Fault(ErrorCode.NOT_FOUND, 404);
    }

    return result.rows[0];
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
          throw new Fault(ErrorCode.PROFILE_NOT_READY, 409);
        }

        if (
          target.authMode === ProfileAuthMode.ApiKey &&
          (!policy.apiSpending.enabled || policy.apiSpending.limitUsd === null)
        ) {
          throw new Fault(ErrorCode.INVALID_REQUEST, 400);
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
