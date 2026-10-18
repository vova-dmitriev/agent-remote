import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  ProfileAction,
  ProfileAuthMode,
  ProfileOperationPhase,
  ProfileRequestKind,
  ProfileStatus,
} from '../packages/protocol/src/index.js';
import { CodexProfileNative } from '../apps/daemon/src/profiles/native/codex.js';
import { ProfileProcessCleanupError } from '../apps/daemon/src/profiles/native/lifecycle/errors.js';
import { RuntimeProfiles } from '../apps/daemon/src/profiles/runtime/service.js';
import { deferred } from './profiles/runtime/deferred.js';
import { codexSubscription, verifiedAccount } from './profiles/registry.fixture.js';
import { profileServiceFixture } from './profiles/service.fixture.js';

afterEach(() => vi.restoreAllMocks());

function runtimeFixture(authMode = ProfileAuthMode.Subscription) {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create({ ...codexSubscription, authMode });

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  return { options, service, profile, runtime };
}

function referenceCount(options: ReturnType<typeof profileServiceFixture>['options'], profileId: string) {
  return (
    options.database.connection
      .prepare('SELECT COUNT(*) AS count FROM profile_execution_refs WHERE profile=?')
      .get(profileId) as { count: number }
  ).count;
}

it('cancels a delivered sign-in only after its native process closes for removal', async () => {
  const f = runtimeFixture();
  const closing = deferred<void>();
  const closeStarted = deferred<void>();

  const close = vi.fn(async () => {
    closeStarted.resolve();
    await closing.promise;
  });

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    loginSubscription: async () => ({ loginId: 'login', authUrl: 'https://auth.openai.com/authorize' }),
    probe: async () => verifiedAccount(),
    close,
  } as unknown as CodexProfileNative);

  try {
    const started = await f.runtime.request({
      kind: ProfileRequestKind.Authenticate,
      input: {
        action: ProfileAction.SignIn,
        operationId: randomUUID(),
        profileId: f.profile.id,
        expectedVersion: f.profile.version,
      },
    });

    expect(started.kind).toBe(ProfileRequestKind.Authenticate);

    if (started.kind !== ProfileRequestKind.Authenticate) {
      throw new Error('unexpected response');
    }

    const operationId = started.data.id;

    expect(started.data.phase).toBe(ProfileOperationPhase.AwaitingAuthentication);

    const removing = f.runtime.request({
      kind: ProfileRequestKind.Mutate,
      mutation: {
        action: ProfileAction.Remove,
        operationId: randomUUID(),
        profileId: f.profile.id,
        expectedVersion: f.service.registry.get(f.profile.id).version,
      },
    });

    await closeStarted.promise;
    expect(f.service.registry.get(f.profile.id).status).toBe('removing');
    expect(f.service.operation(operationId).phase).toBe(ProfileOperationPhase.AwaitingAuthentication);
    expect(referenceCount(f.options, f.profile.id)).toBe(1);

    closing.resolve();
    const removed = await removing;

    expect(removed.kind).toBe(ProfileRequestKind.Mutate);
    expect(f.service.operation(operationId).phase).toBe(ProfileOperationPhase.Failed);
    expect(referenceCount(f.options, f.profile.id)).toBe(0);
  } finally {
    closing.resolve();
    await f.runtime.close().catch(() => undefined);
  }
});

it('leaves an authentication mutation blocking when native close cannot be confirmed', async () => {
  const f = runtimeFixture();
  const probing = deferred<void>();
  const probeResult = deferred<ReturnType<typeof verifiedAccount>>();

  const close = vi.fn(async () => {
    throw new ProfileProcessCleanupError();
  });

  const ready = f.service.registry.verify(f.profile.id, f.profile.version, verifiedAccount());

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    loginSubscription: async () => ({ loginId: 'login', authUrl: 'https://auth.openai.com/authorize' }),
    probe: async () => {
      probing.resolve();

      return probeResult.promise;
    },
    close,
  } as unknown as CodexProfileNative);

  try {
    const checking = f.runtime.request({
      kind: ProfileRequestKind.Authenticate,
      input: {
        action: ProfileAction.Check,
        operationId: randomUUID(),
        profileId: f.profile.id,
        expectedVersion: ready.version,
      },
    });

    await probing.promise;
    const operationId = f.service.list().operations.find((item) => item.action === ProfileAction.Check)?.id;

    if (!operationId) {
      throw new Error('expected active check operation');
    }

    const removal = await f.runtime.request({
      kind: ProfileRequestKind.Mutate,
      mutation: {
        action: ProfileAction.Remove,
        operationId: randomUUID(),
        profileId: f.profile.id,
        expectedVersion: f.service.registry.get(f.profile.id).version,
      },
    });

    expect(removal.kind).toBe(ProfileRequestKind.Mutate);
    expect(f.service.registry.get(f.profile.id).status).toBe(ProfileStatus.Removing);
    expect(f.service.operation(operationId).phase).toBe(ProfileOperationPhase.Preparing);
    expect(referenceCount(f.options, f.profile.id)).toBe(1);
    probeResult.resolve(verifiedAccount());
    await expect(checking).rejects.toThrow(ErrorCode.REQUEST_TIMEOUT);
  } finally {
    probeResult.resolve(verifiedAccount());
    await f.runtime.close().catch(() => undefined);
  }
});
