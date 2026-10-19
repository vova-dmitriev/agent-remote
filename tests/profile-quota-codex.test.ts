import { expect, it } from 'vitest';
import { readCodexQuota } from '../apps/daemon/src/profiles/quota/codex-observation.js';
import { AgentProvider } from '../packages/protocol/src/values/command.js';
import {
  ProfileAuthMode,
  ProfileStatus,
  CapabilitySupport,
} from '../packages/protocol/src/values/execution.js';
import { QuotaObservationStatus, QuotaScopeKind } from '../packages/protocol/src/values/profile-routing.js';
import { executionProfileSummarySchema } from '../packages/protocol/src/execution-profile.js';

const profile = executionProfileSummarySchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: 'owner-a',
  deviceId: 'device-a',
  provider: AgentProvider.Codex,
  authMode: ProfileAuthMode.Subscription,
  label: 'Primary',
  status: ProfileStatus.Ready,
  identity: {
    accountRef: 'codex-account:account-a',
    workspaceRef: 'workspace-a',
    verifiedAt: 100,
  },
  capabilities: {
    isolation: CapabilitySupport.Supported,
    createSession: true,
    contextSeed: true,
    resume: false,
    quota: false,
  },
  models: [],
  version: 4,
  updatedAt: 100,
});

it('keeps generic rate-limit events and full percentages unknown', () => {
  const result = readCodexQuota(
    profile,
    {
      ordinaryUsageAllowed: null,
      accountId: 'workspace-a',
      rateLimitsByLimitId: {
        codex: {
          limitId: 'codex',
          normalModelSlug: 'gpt-test',
          primary: { usedPercent: 100, resetsAt: 200 },
          rateLimitReachedType: 'rate_limit_reached',
        },
      },
    },
    300,
  );

  expect(result.status).toBe(QuotaObservationStatus.Unknown);
  expect(result.usedPercent).toBe(100);
  expect(result.scope.kind).toBe(QuotaScopeKind.ModelFamily);
});

it('uses only authoritative workspace limit evidence and verifies account identity', () => {
  const result = readCodexQuota(
    profile,
    {
      ordinaryUsageAllowed: null,
      accountId: 'workspace-a',
      rateLimitsByLimitId: {
        codex: { limitId: 'codex', rateLimitReachedType: 'workspace_member_usage_limit_reached' },
      },
    },
    300,
  );

  expect(result.status).toBe(QuotaObservationStatus.Exhausted);
  expect(result.poolId).toBe('codex');
  expect(() => readCodexQuota(profile, { accountId: 'workspace-b' }, 300)).toThrow();
});

it('does not invent an available observation when rate-limit data is partial', () => {
  const result = readCodexQuota(profile, { rateLimitsByLimitId: {} }, 300);

  expect(result.status).toBe(QuotaObservationStatus.Unknown);
  expect(result.evidence).toBeNull();
});
