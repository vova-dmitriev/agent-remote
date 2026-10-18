import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ProfileAction,
  ProfileAuthMode,
  ProfileOperationPhase,
  ProfileRequestKind,
} from '../packages/protocol/src/index.js';
import { CodexProfileNative } from '../apps/daemon/src/profiles/native/codex.js';
import { ProfileAuthenticationPool } from '../apps/daemon/src/profiles/authentication/pool.js';
import { RuntimeProfiles } from '../apps/daemon/src/profiles/runtime/service.js';
import { deferred } from './profiles/runtime/deferred.js';
import { codexSubscription, verifiedAccount } from './profiles/registry.fixture.js';
import { profileServiceFixture } from './profiles/service.fixture.js';

afterEach(() => vi.restoreAllMocks());

it('waits for SignIn startup to prove no child before completing removal', async () => {
  const f = profileServiceFixture();
  const profile = f.service.registry.create({ ...codexSubscription, authMode: ProfileAuthMode.Subscription });

  const runtime = new RuntimeProfiles({
    ...f.options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  const closeStarted = deferred<void>();
  const finishClose = deferred<boolean>();
  const originalClose = ProfileAuthenticationPool.prototype.close;
  let closeCalls = 0;

  vi.spyOn(ProfileAuthenticationPool.prototype, 'close').mockImplementation(function (
    this: ProfileAuthenticationPool,
    id,
    version,
  ) {
    closeCalls++;

    if (closeCalls === 1) {
      closeStarted.resolve();

      return finishClose.promise;
    }

    return originalClose.call(this, id, version);
  });

  const open = vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    loginSubscription: async () => ({ loginId: 'login', authUrl: 'https://auth.openai.com/authorize' }),
    probe: async () => verifiedAccount(),
    close: async () => {},
  } as unknown as CodexProfileNative);

  const signIn = runtime.request({
    kind: ProfileRequestKind.Authenticate,
    input: {
      action: ProfileAction.SignIn,
      operationId: randomUUID(),
      profileId: profile.id,
      expectedVersion: profile.version,
    },
  });

  await closeStarted.promise;

  const authentication = f.service
    .list()
    .operations.find((operation) => operation.action === ProfileAction.SignIn);

  if (!authentication) {
    throw new Error('expected persisted SignIn operation');
  }

  const removal = runtime.request({
    kind: ProfileRequestKind.Mutate,
    mutation: {
      action: ProfileAction.Remove,
      operationId: randomUUID(),
      profileId: profile.id,
      expectedVersion: f.service.registry.get(profile.id).version,
    },
  });

  const completedEarly = await Promise.race([
    removal.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);

  expect(completedEarly).toBe(false);
  expect(f.service.operation(authentication.id).phase).toBe(ProfileOperationPhase.Preparing);

  finishClose.resolve(false);
  const [signInResult, removalResult] = await Promise.all([signIn, removal]);

  expect(signInResult.kind).toBe(ProfileRequestKind.Authenticate);
  expect(removalResult.kind).toBe(ProfileRequestKind.Mutate);

  if (removalResult.kind === ProfileRequestKind.Mutate) {
    expect(removalResult.data.phase).toBe(ProfileOperationPhase.Complete);
  }

  expect(f.service.operation(authentication.id).phase).toBe(ProfileOperationPhase.Failed);
  expect(open).not.toHaveBeenCalled();
  await runtime.close();
});

it('terminalizes a fenced pre-open SignIn before a later removal', async () => {
  const f = profileServiceFixture();
  const profile = f.service.registry.create({ ...codexSubscription, authMode: ProfileAuthMode.Subscription });

  const runtime = new RuntimeProfiles({
    ...f.options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  const closeStarted = deferred<void>();
  const finishClose = deferred<boolean>();
  const originalClose = ProfileAuthenticationPool.prototype.close;
  let current = true;
  let closeCalls = 0;

  vi.spyOn(ProfileAuthenticationPool.prototype, 'close').mockImplementation(function (
    this: ProfileAuthenticationPool,
    id,
    version,
  ) {
    closeCalls++;

    if (closeCalls === 1) {
      closeStarted.resolve();

      return finishClose.promise;
    }

    return originalClose.call(this, id, version);
  });

  const open = vi.spyOn(CodexProfileNative, 'open');
  const signInId = randomUUID();

  const signIn = runtime.request(
    {
      kind: ProfileRequestKind.Authenticate,
      input: {
        action: ProfileAction.SignIn,
        operationId: signInId,
        profileId: profile.id,
        expectedVersion: profile.version,
      },
    },
    () => current,
  );

  await closeStarted.promise;
  current = false;
  finishClose.resolve(false);
  await expect(signIn).rejects.toThrow();

  const persisted = await runtime.request({ kind: ProfileRequestKind.Operation, operationId: signInId });

  expect(persisted.kind).toBe(ProfileRequestKind.Operation);

  if (persisted.kind === ProfileRequestKind.Operation) {
    expect(persisted.data.phase).toBe(ProfileOperationPhase.Failed);
  }

  expect(open).not.toHaveBeenCalled();

  const removal = await runtime.request({
    kind: ProfileRequestKind.Mutate,
    mutation: {
      action: ProfileAction.Remove,
      operationId: randomUUID(),
      profileId: profile.id,
      expectedVersion: f.service.registry.get(profile.id).version,
    },
  });

  expect(removal.kind).toBe(ProfileRequestKind.Mutate);

  if (removal.kind === ProfileRequestKind.Mutate) {
    expect(removal.data.phase).toBe(ProfileOperationPhase.Complete);
  }

  await runtime.close();
});
