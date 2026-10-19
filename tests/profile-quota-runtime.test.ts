import { afterEach, expect, it, vi } from 'vitest';
import { ProfileRequestKind } from '../packages/protocol/src/values/profile-management.js';
import {
  QuotaEvidenceKind,
  QuotaObservationStatus,
} from '../packages/protocol/src/values/profile-routing.js';
import { CodexProfileNative } from '../apps/daemon/src/profiles/native/codex.js';
import { RuntimeProfiles } from '../apps/daemon/src/profiles/runtime/service.js';
import { profileServiceFixture } from './profiles/service.fixture.js';
import { codexSubscription, verifiedAccount } from './profiles/registry.fixture.js';

afterEach(() => vi.restoreAllMocks());

it('reads authoritative Codex quota while input is disabled and releases its execution fence after close', async () => {
  const { options, service } = profileServiceFixture();
  const created = service.registry.create(codexSubscription);
  const profile = service.registry.verify(created.id, created.version, verifiedAccount());

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: false,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  const close = vi.fn(async () => {});

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    probe: async () => verifiedAccount(),
    readRateLimits: async () => ({
      accountId: 'workspace-a',
      ordinaryUsageAllowed: false,
      rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: 100 } } },
    }),
    close,
  } as unknown as CodexProfileNative);

  try {
    const result = await runtime.request({
      kind: ProfileRequestKind.Quota,
      profileId: profile.id,
      expectedVersion: profile.version,
    });

    expect(result.kind).toBe(ProfileRequestKind.Quota);

    if (result.kind === ProfileRequestKind.Quota) {
      expect(result.data?.status).toBe(QuotaObservationStatus.Exhausted);
      expect(result.data?.evidence?.kind).toBe(QuotaEvidenceKind.UsageBlocked);
    }

    expect(close).toHaveBeenCalledOnce();

    expect(
      options.database.connection.prepare('SELECT COUNT(*) AS count FROM profile_execution_refs').get(),
    ).toEqual({ count: 0 });
  } finally {
    await runtime.close();
  }
});

it('retains durable profile ownership when quota helper close is unconfirmed', async () => {
  const { options, service } = profileServiceFixture();
  const created = service.registry.create(codexSubscription);
  const profile = service.registry.verify(created.id, created.version, verifiedAccount());

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    probe: async () => verifiedAccount(),
    readRateLimits: async () => ({ ordinaryUsageAllowed: true, rateLimitsByLimitId: {} }),
    close: async () => {
      throw new Error('synthetic close uncertain');
    },
  } as unknown as CodexProfileNative);

  try {
    await expect(
      runtime.request({
        kind: ProfileRequestKind.Quota,
        profileId: profile.id,
        expectedVersion: profile.version,
      }),
    ).rejects.toThrow('synthetic close uncertain');

    expect(
      options.database.connection
        .prepare('SELECT COUNT(*) AS count FROM profile_execution_refs WHERE profile=?')
        .get(profile.id),
    ).toEqual({ count: 1 });
  } finally {
    await runtime.close().catch(() => undefined);
  }
});
