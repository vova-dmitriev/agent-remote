import {
  ErrorCode,
  type ExecutionProfileSummary,
  type ProfileQuotaObservation,
  AgentProvider,
  ProfileAuthMode,
  ProfileStatus,
  QuotaObservationStatus,
  QuotaScopeKind,
  QuotaSource,
} from '@protocol';
import type { ProfileRegistry } from '../registry.js';
import { RuntimeProfileNative } from '../runtime/native/native.js';
import { ProfileExecutionOwnership } from '../runtime/execution/execution-ownership.js';
import { readCodexQuota } from './codex-observation.js';

function unsupported(profile: ExecutionProfileSummary): ProfileQuotaObservation {
  if (!profile.identity) {
    throw new Error(ErrorCode.PROFILE_NOT_READY);
  }

  return {
    ownerId: profile.ownerId,
    deviceId: profile.deviceId,
    profileId: profile.id,
    profileVersion: profile.version,
    provider: profile.provider,
    authMode: profile.authMode,
    accountRef: profile.identity.accountRef,
    ...(profile.identity.workspaceRef ? { workspaceRef: profile.identity.workspaceRef } : {}),
    source: QuotaSource.Unsupported,
    supported: false,
    scope: profile.identity.workspaceRef
      ? { kind: QuotaScopeKind.Workspace, id: profile.identity.workspaceRef }
      : { kind: QuotaScopeKind.Account, id: profile.identity.accountRef },
    status: QuotaObservationStatus.Unknown,
    evidence: null,
    observedAt: Date.now(),
  };
}

export class RuntimeProfileQuotaService {
  constructor(
    private registry: ProfileRegistry,
    private native: RuntimeProfileNative,
    private ownership: ProfileExecutionOwnership,
  ) {}

  async read(profileId: string, expectedVersion: number, current: () => boolean) {
    const profile = this.registry.get(profileId);

    if (profile.version !== expectedVersion) {
      throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
    }

    if (profile.status !== ProfileStatus.Ready) {
      throw new Error(ErrorCode.PROFILE_NOT_READY);
    }

    if (!profile.identity) {
      throw new Error(ErrorCode.PROFILE_NOT_READY);
    }

    if (profile.provider !== AgentProvider.Codex || profile.authMode !== ProfileAuthMode.Subscription) {
      return unsupported(profile);
    }

    const lease = this.ownership.reserve(profile.id, expectedVersion);

    try {
      const { verification, response } = await this.native.readQuota(profile, current);

      if (
        !verification.identity ||
        verification.identity.accountRef !== profile.identity.accountRef ||
        verification.identity.workspaceRef !== profile.identity.workspaceRef
      ) {
        throw new Error(ErrorCode.PROFILE_MISMATCH);
      }

      const latest = this.registry.get(profile.id);

      if (latest.status !== ProfileStatus.Ready || latest.version !== expectedVersion || !current()) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      const observation = readCodexQuota(latest, response, Date.now());

      lease.releaseBeforeLaunch();

      return observation;
    } catch (error) {
      if (!this.native.hasUnconfirmedHandle(profile.id)) {
        lease.releaseBeforeLaunch();
      }

      throw error;
    }
  }
}
