import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentProvider, ErrorCode, ProfileAction, ProfileRequestKind } from '@protocol';
import { CodexProfileNative } from '@daemon/profiles/native/codex.js';
import { ProfileProcessCleanupError } from '@daemon/profiles/native/lifecycle/errors.js';
import { RuntimeProfiles } from '@daemon/runtime/services/runtime-profiles.js';
import { codexSubscription, verifiedAccount } from '../fixtures/registry.fixture.js';
import { profileServiceFixture } from '../fixtures/service.fixture.js';

afterEach(() => vi.restoreAllMocks());

it('retains the durable execution reference when prelaunch native close is unconfirmed', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);
  const ready = service.registry.verify(profile.id, profile.version, verifiedAccount());

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    probe: async () => verifiedAccount(),
    close: async () => {
      throw new ProfileProcessCleanupError();
    },
  } as unknown as CodexProfileNative);

  const selection = { profileId: profile.id, provider: AgentProvider.Codex, model: 'synthetic-model' };

  try {
    await expect(runtime.prepareExecution(selection, ready.version)).rejects.toThrow(
      ErrorCode.REQUEST_TIMEOUT,
    );

    const count = options.database.connection
      .prepare('SELECT COUNT(*) AS count FROM profile_execution_refs WHERE profile=?')
      .get(profile.id) as { count: number };

    expect(count.count).toBe(1);

    const restarted = new RuntimeProfiles({
      ...options,
      inputEnabled: true,
      baseEnvironment: {},
      native: { executable: process.execPath },
    });

    try {
      await expect(
        restarted.request({
          kind: ProfileRequestKind.Mutate,
          mutation: {
            action: ProfileAction.Disable,
            operationId: randomUUID(),
            profileId: profile.id,
            expectedVersion: ready.version,
          },
        }),
      ).rejects.toThrow(ErrorCode.PROFILE_EXECUTION_ACTIVE);
    } finally {
      await restarted.close();
    }
  } finally {
    await runtime.close().catch(() => undefined);
  }
});

it('releases prelaunch ownership when the native probe is positively closed but mismatches', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);
  const ready = service.registry.verify(profile.id, profile.version, verifiedAccount());

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    probe: async () => verifiedAccount('different-account'),
    close: async () => undefined,
  } as unknown as CodexProfileNative);

  try {
    await expect(
      runtime.prepareExecution(
        { profileId: profile.id, provider: AgentProvider.Codex, model: 'synthetic-model' },
        ready.version,
      ),
    ).rejects.toThrow(ErrorCode.PROFILE_MISMATCH);

    const count = options.database.connection
      .prepare('SELECT COUNT(*) AS count FROM profile_execution_refs WHERE profile=?')
      .get(profile.id) as { count: number };

    expect(count.count).toBe(0);
  } finally {
    await runtime.close();
  }
});

it('releases prelaunch ownership when validation fails before opening a native child', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);
  const ready = service.registry.verify(profile.id, profile.version, verifiedAccount());

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  const open = vi.spyOn(CodexProfileNative, 'open');
  let checks = 0;

  try {
    await expect(
      runtime.prepareExecution(
        { profileId: profile.id, provider: AgentProvider.Codex, model: 'synthetic-model' },
        ready.version,
        () => ++checks < 2,
      ),
    ).rejects.toThrow(ErrorCode.UNAUTHORIZED);

    const count = options.database.connection
      .prepare('SELECT COUNT(*) AS count FROM profile_execution_refs WHERE profile=?')
      .get(profile.id) as { count: number };

    expect(open).not.toHaveBeenCalled();
    expect(count.count).toBe(0);
  } finally {
    await runtime.close();
  }
});
