import { expect, it } from 'vitest';
import { profileQuotaObservationSchema } from '../packages/protocol/src/profile-quota.js';
import { AgentProvider } from '../packages/protocol/src/values/command.js';
import { ProfileAuthMode } from '../packages/protocol/src/values/execution.js';
import {
  CodexRateLimitReachedType,
  QuotaEvidenceKind,
  QuotaObservationStatus,
  QuotaScopeKind,
} from '../packages/protocol/src/values/profile-routing.js';

const observation = {
  ownerId: 'owner-a',
  deviceId: 'device-a',
  profileId: '11111111-1111-4111-8111-111111111111',
  profileVersion: 2,
  provider: AgentProvider.Codex,
  authMode: ProfileAuthMode.Subscription,
  accountRef: 'codex:account-a',
  workspaceRef: 'workspace-a',
  source: 'unsupported',
  supported: false,
  scope: { kind: QuotaScopeKind.Workspace, id: 'codex' },
  status: QuotaObservationStatus.Unknown,
  evidence: null,
  usedPercent: 100,
  observedAt: Date.now(),
};

it('does not interpret a full usage percentage as exhausted quota', () => {
  expect(profileQuotaObservationSchema.parse(observation).status).toBe(QuotaObservationStatus.Unknown);
});

it('accepts exhaustion only with a typed native limit-reached reason', () => {
  const parsed = profileQuotaObservationSchema.parse({
    ...observation,
    status: QuotaObservationStatus.Exhausted,
    evidence: {
      kind: QuotaEvidenceKind.LimitReached,
      reason: CodexRateLimitReachedType.WorkspaceMemberUsageLimitReached,
    },
  });

  expect(parsed.status).toBe(QuotaObservationStatus.Exhausted);
  expect(profileQuotaObservationSchema.safeParse({ ...parsed, evidence: null }).success).toBe(false);
});

it('rejects an available state without authoritative ordinary-usage permission', () => {
  expect(
    profileQuotaObservationSchema.safeParse({
      ...observation,
      status: QuotaObservationStatus.Available,
    }).success,
  ).toBe(false);
});
