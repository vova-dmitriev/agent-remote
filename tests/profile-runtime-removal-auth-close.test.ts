import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ProfileAction,
  ProfileAuthMode,
  ProfileOperationPhase,
  ProfileRequestKind,
  ProfileStatus,
} from '@protocol';
import { CodexProfileNative } from '../apps/daemon/src/profiles/native/codex.js';
import { RuntimeProfiles } from '../apps/daemon/src/runtime/services/runtime-profiles.js';
import { deferred } from './profiles/runtime/deferred.js';
import { codexSubscription, verifiedAccount } from './profiles/registry.fixture.js';
import { profileServiceFixture } from './profiles/service.fixture.js';

afterEach(() => vi.restoreAllMocks());

it('holds a Check reference and defers readiness until native close is confirmed', async () => {
  const f = profileServiceFixture();
  const created = f.service.registry.create(codexSubscription);
  const ready = f.service.registry.verify(created.id, created.version, verifiedAccount());

  const runtime = new RuntimeProfiles({
    ...f.options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  const closeStarted = deferred<void>();
  const finishClose = deferred<void>();

  const close = vi.fn(async () => {
    closeStarted.resolve();
    await finishClose.promise;
  });

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    loginSubscription: async () => ({ loginId: 'login', authUrl: 'https://auth.openai.com/authorize' }),
    probe: async () => verifiedAccount(),
    close,
  } as unknown as CodexProfileNative);

  const checkId = randomUUID();

  const checking = runtime.request({
    kind: ProfileRequestKind.Authenticate,
    input: {
      action: ProfileAction.Check,
      operationId: checkId,
      profileId: created.id,
      expectedVersion: ready.version,
    },
  });

  await closeStarted.promise;

  const persisted = await runtime.request({
    kind: ProfileRequestKind.Operation,
    operationId: checkId,
  });

  const check = persisted.kind === ProfileRequestKind.Operation ? persisted.data : undefined;

  if (!check) {
    throw new Error('expected persisted Check operation');
  }

  expect(check.phase).toBe(ProfileOperationPhase.Preparing);
  expect(f.service.registry.get(created.id).version).toBe(ready.version);

  const removing = runtime.request({
    kind: ProfileRequestKind.Mutate,
    mutation: {
      action: ProfileAction.Remove,
      operationId: randomUUID(),
      profileId: created.id,
      expectedVersion: ready.version,
    },
  });

  await vi.waitFor(() => expect(f.service.registry.get(created.id).status).toBe(ProfileStatus.Removing));
  expect(check.phase).toBe(ProfileOperationPhase.Preparing);

  expect(
    (
      f.options.database.connection
        .prepare('SELECT COUNT(*) AS count FROM profile_execution_refs WHERE profile=?')
        .get(created.id) as { count: number }
    ).count,
  ).toBe(1);

  finishClose.resolve();
  const [checkResult, removeResult] = await Promise.all([checking, removing]);

  expect(checkResult.kind).toBe(ProfileRequestKind.Authenticate);
  expect(removeResult.kind).toBe(ProfileRequestKind.Mutate);

  if (removeResult.kind === ProfileRequestKind.Mutate) {
    expect(removeResult.data.phase).toBe(ProfileOperationPhase.Complete);
  }

  const finalOperation = await runtime.request({ kind: ProfileRequestKind.Operation, operationId: check.id });

  expect(finalOperation.kind).toBe(ProfileRequestKind.Operation);

  if (finalOperation.kind === ProfileRequestKind.Operation) {
    expect(finalOperation.data.phase).toBe(ProfileOperationPhase.Failed);
  }

  await runtime.close();
});

it('does not restore AwaitingAuthentication when a held not-ready probe finishes after removal', async () => {
  const f = profileServiceFixture();
  const profile = f.service.registry.create({ ...codexSubscription, authMode: ProfileAuthMode.Subscription });

  const runtime = new RuntimeProfiles({
    ...f.options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  const probeStarted = deferred<void>();
  let failProbe!: (error: Error) => void;
  const finishProbe = new Promise<ReturnType<typeof verifiedAccount>>((_, reject) => (failProbe = reject));

  void finishProbe.catch(() => undefined);
  const closeStarted = deferred<void>();
  const operationId = randomUUID();

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    loginSubscription: async () => ({ loginId: 'login', authUrl: 'https://auth.openai.com/authorize' }),
    probe: async () => {
      probeStarted.resolve();

      return finishProbe;
    },
    close: async () => closeStarted.resolve(),
  } as unknown as CodexProfileNative);

  const started = await runtime.request({
    kind: ProfileRequestKind.Authenticate,
    input: {
      action: ProfileAction.SignIn,
      operationId,
      profileId: profile.id,
      expectedVersion: profile.version,
    },
  });

  expect(started.kind).toBe(ProfileRequestKind.Authenticate);

  const reconciliation = runtime.request({ kind: ProfileRequestKind.Reconcile, operationId });

  await probeStarted.promise;

  const removal = runtime.request({
    kind: ProfileRequestKind.Mutate,
    mutation: {
      action: ProfileAction.Remove,
      operationId: randomUUID(),
      profileId: profile.id,
      expectedVersion: f.service.registry.get(profile.id).version,
    },
  });

  await closeStarted.promise;
  const removed = await removal;

  if (removed.kind === ProfileRequestKind.Mutate) {
    expect(removed.data.phase).toBe(ProfileOperationPhase.Complete);
  }

  const beforeProbe = await runtime.request({ kind: ProfileRequestKind.Operation, operationId });

  expect(beforeProbe.kind).toBe(ProfileRequestKind.Operation);

  if (beforeProbe.kind === ProfileRequestKind.Operation) {
    expect(beforeProbe.data.phase).toBe(ProfileOperationPhase.Failed);
  }

  const alreadySettled = await Promise.race([reconciliation.then(() => true), Promise.resolve(false)]);

  expect(alreadySettled).toBe(false);

  failProbe(new Error('PROFILE_NOT_READY'));
  await reconciliation;

  const final = await runtime.request({ kind: ProfileRequestKind.Operation, operationId });

  expect(final.kind).toBe(ProfileRequestKind.Operation);

  if (final.kind === ProfileRequestKind.Operation) {
    expect(final.data.phase).toBe(ProfileOperationPhase.Failed);
  }

  await runtime.close();
});
