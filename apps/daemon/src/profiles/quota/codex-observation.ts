import { z } from 'zod';
import {
  AgentProvider,
  CodedError,
  CodexRateLimitReachedType,
  ErrorCode,
  type ExecutionProfileSummary,
  ProfileAuthMode,
  type ProfileQuotaObservation,
  profileQuotaObservationSchema,
  QuotaEvidenceKind,
  QuotaObservationStatus,
  QuotaScopeKind,
  QuotaSource,
} from '@protocol';
import { CodexQuotaMeter, CodexQuotaTime } from './values.js';

const windowSchema = z.object({
  usedPercent: z.number().int().min(0).max(100).nullish(),
  resetsAt: z.number().int().positive().nullish(),
});

const snapshotSchema = z.object({
  limitId: z.string().min(1).max(128).nullish(),
  normalModelSlug: z.string().min(1).max(256).nullish(),
  primary: windowSchema.nullish(),
  rateLimitReachedType: z.enum(CodexRateLimitReachedType).nullish(),
});

const responseSchema = z.object({
  ordinaryUsageAllowed: z.boolean().nullish(),
  accountId: z.string().min(1).max(512).nullish(),
  rateLimits: snapshotSchema.nullish(),
  rateLimitsByLimitId: z.record(z.string(), snapshotSchema).nullish(),
});

function reachedQuota(reason: z.infer<typeof snapshotSchema>['rateLimitReachedType']) {
  return reason !== undefined && reason !== null && reason !== CodexRateLimitReachedType.RateLimitReached;
}

function observationStatus(exhausted: boolean, available: boolean) {
  if (exhausted) {
    return QuotaObservationStatus.Exhausted;
  }

  return available ? QuotaObservationStatus.Available : QuotaObservationStatus.Unknown;
}

function observationEvidence(
  exhausted: boolean,
  available: boolean,
  reason: z.infer<typeof snapshotSchema>['rateLimitReachedType'],
) {
  if (exhausted) {
    return reason && reason !== CodexRateLimitReachedType.RateLimitReached
      ? { kind: QuotaEvidenceKind.LimitReached, reason }
      : { kind: QuotaEvidenceKind.UsageBlocked, allowed: false };
  }

  return available ? { kind: QuotaEvidenceKind.UsageAllowed } : null;
}

function observationScope(profile: ExecutionProfileSummary, modelId: string | undefined) {
  if (modelId) {
    return { kind: QuotaScopeKind.ModelFamily, id: modelId };
  }

  const workspaceRef = profile.identity?.workspaceRef;

  if (workspaceRef) {
    return { kind: QuotaScopeKind.Workspace, id: workspaceRef };
  }

  return { kind: QuotaScopeKind.Account, id: profile.identity?.accountRef };
}

export function readCodexQuota(
  profile: ExecutionProfileSummary,
  raw: unknown,
  observedAt: number,
): ProfileQuotaObservation {
  const response = responseSchema.parse(raw);

  if (!profile.identity) {
    throw new CodedError(ErrorCode.PROFILE_NOT_READY);
  }

  if (
    response.accountId &&
    profile.identity.workspaceRef &&
    response.accountId !== profile.identity.workspaceRef
  ) {
    throw new CodedError(ErrorCode.PROFILE_MISMATCH);
  }

  const keyed = response.rateLimitsByLimitId?.[CodexQuotaMeter.Codex];
  const legacy = response.rateLimits?.limitId === CodexQuotaMeter.Codex ? response.rateLimits : undefined;
  const snapshot = keyed ?? legacy;
  const reason = snapshot?.rateLimitReachedType;
  const exhausted = response.ordinaryUsageAllowed === false || reachedQuota(reason);
  const available = response.ordinaryUsageAllowed === true;

  const status = observationStatus(exhausted, available);
  const evidence = observationEvidence(exhausted, available, reason);

  const modelId = snapshot?.normalModelSlug ?? undefined;

  const observation = {
    ownerId: profile.ownerId,
    deviceId: profile.deviceId,
    profileId: profile.id,
    profileVersion: profile.version,
    provider: profile.provider,
    authMode: profile.authMode,
    accountRef: profile.identity.accountRef,
    ...(profile.identity.workspaceRef ? { workspaceRef: profile.identity.workspaceRef } : {}),
    source: QuotaSource.CodexRateLimits,
    supported: profile.provider === AgentProvider.Codex && profile.authMode === ProfileAuthMode.Subscription,
    scope: observationScope(profile, modelId),
    ...(snapshot?.limitId ? { poolId: snapshot.limitId } : {}),
    ...(modelId ? { modelId } : {}),
    status,
    evidence,
    ...(snapshot?.primary?.usedPercent !== null && snapshot?.primary?.usedPercent !== undefined
      ? { usedPercent: snapshot.primary.usedPercent }
      : {}),
    ...(snapshot?.primary?.resetsAt
      ? { resetsAt: snapshot.primary.resetsAt * CodexQuotaTime.SecondsToMilliseconds }
      : {}),
    observedAt,
  };

  return profileQuotaObservationSchema.parse(observation);
}
