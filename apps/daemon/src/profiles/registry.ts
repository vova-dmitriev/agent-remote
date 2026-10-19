import { immutableProfileScope } from './storage/scope.js';
import { randomUUID } from 'node:crypto';
import {
  type AgentProvider,
  CapabilitySupport,
  CodedError,
  ErrorCode,
  type ExecutionProfileSummary,
  executionProfileSummarySchema,
  ProfileStatus,
} from '@protocol';
import type { LocalDatabase } from '../local/state/database.js';
import { ProfileRepository } from './storage/repository.js';
import {
  createProfileSchema,
  updateProfileSchema,
  type CreateProfile,
  type ProfileScope,
  type ProfileVerification,
  type UpdateProfile,
} from './types.js';
import { verifyProfileObservation, unverifiedProfileCapabilities } from './capabilities.js';

export class ProfileRegistry {
  private repository: ProfileRepository;
  private scope: ProfileScope;

  constructor(database: LocalDatabase, scope: ProfileScope) {
    this.scope = immutableProfileScope(scope);
    this.repository = new ProfileRepository(database, this.scope);
  }

  create(input: CreateProfile): ExecutionProfileSummary {
    const value = createProfileSchema.parse(input);

    return this.repository.create(
      executionProfileSummarySchema.parse({
        ...value,
        ...this.scope,
        id: randomUUID(),
        version: 1,
        updatedAt: Date.now(),
        status: ProfileStatus.NeedsAuthentication,
        identity: null,
        models: [],
        capabilities: unverifiedProfileCapabilities(),
      }),
    );
  }

  get(id: string) {
    return this.repository.get(id);
  }

  list() {
    return this.repository.list();
  }

  private mutable(id: string, expectedVersion: number) {
    const profile = this.get(id);

    if (profile.version !== expectedVersion) {
      throw new CodedError(ErrorCode.LOCAL_REVISION_CONFLICT);
    }

    if (profile.status === ProfileStatus.Removed || profile.status === ProfileStatus.Removing) {
      throw new CodedError(ErrorCode.PROFILE_NOT_READY);
    }

    return profile;
  }

  private save(profile: ExecutionProfileSummary, expectedVersion: number) {
    return this.repository.save(
      executionProfileSummarySchema.parse({
        ...profile,
        version: expectedVersion + 1,
        updatedAt: Date.now(),
      }),
      expectedVersion,
    );
  }

  verify(id: string, expectedVersion: number, evidence: ProfileVerification) {
    const profile = this.mutable(id, expectedVersion);
    const observation = verifyProfileObservation(profile, evidence);

    return this.save(
      {
        ...profile,
        ...observation,
        status: profile.status === ProfileStatus.Disabled ? ProfileStatus.Disabled : ProfileStatus.Ready,
      },
      expectedVersion,
    );
  }

  update(id: string, expectedVersion: number, input: UpdateProfile) {
    const profile = this.mutable(id, expectedVersion);
    const change = updateProfileSchema.parse(input);
    let status = profile.status;

    if (change.enabled === false) {
      status = ProfileStatus.Disabled;
    }

    if (change.enabled === true) {
      status =
        profile.identity && profile.capabilities.isolation === CapabilitySupport.Supported
          ? ProfileStatus.Ready
          : ProfileStatus.NeedsAuthentication;
    }

    return this.save({ ...profile, label: change.label ?? profile.label, status }, expectedVersion);
  }

  defaultFor(provider: AgentProvider) {
    return this.repository.defaultFor(provider);
  }

  setDefault(id: string, expectedVersion: number) {
    const profile = this.mutable(id, expectedVersion);

    if (profile.status !== ProfileStatus.Ready) {
      throw new CodedError(ErrorCode.PROFILE_NOT_READY);
    }

    this.repository.setDefault(profile);
  }

  authenticationRequired(id: string, expectedVersion: number) {
    const profile = this.mutable(id, expectedVersion);

    if (profile.status === ProfileStatus.Disabled) {
      throw new CodedError(ErrorCode.PROFILE_NOT_READY);
    }

    return this.save(
      {
        ...profile,
        status: ProfileStatus.NeedsAuthentication,
        identity: null,
        models: [],
        capabilities: unverifiedProfileCapabilities(),
      },
      expectedVersion,
    );
  }

  beginRemoval(id: string, expectedVersion: number) {
    return this.save(
      { ...this.mutable(id, expectedVersion), status: ProfileStatus.Removing },
      expectedVersion,
    );
  }

  completeRemoval(id: string, expectedVersion: number) {
    const profile = this.get(id);

    if (profile.version !== expectedVersion) {
      throw new CodedError(ErrorCode.LOCAL_REVISION_CONFLICT);
    }

    if (profile.status !== ProfileStatus.Removing) {
      throw new CodedError(ErrorCode.PROFILE_NOT_READY);
    }

    return this.save(
      {
        ...profile,
        status: ProfileStatus.Removed,
        identity: null,
        models: [],
        capabilities: unverifiedProfileCapabilities(),
      },
      expectedVersion,
    );
  }
}
