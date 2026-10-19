import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  ProfileAction,
  ProfileAuthMode,
  ProfileOperationPhase,
  ProfileRequestKind,
} from '@protocol';
import { encryptEnrollment } from '@transport/credentials/sealed-box.js';
import { CodexProfileNative } from '../apps/daemon/src/profiles/native/codex.js';
import { RuntimeProfiles } from '../apps/daemon/src/profiles/runtime/service.js';
import { deferred } from './profiles/runtime/deferred.js';
import { codexSubscription, verifiedAccount } from './profiles/registry.fixture.js';
import { profileServiceFixture } from './profiles/service.fixture.js';

afterEach(() => vi.restoreAllMocks());

function runtime(options: ReturnType<typeof profileServiceFixture>['options']) {
  return new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });
}

function references(options: ReturnType<typeof profileServiceFixture>['options'], profileId: string) {
  return (
    options.database.connection
      .prepare('SELECT COUNT(*) AS count FROM profile_execution_refs WHERE profile=?')
      .get(profileId) as { count: number }
  ).count;
}

it('keeps a persisted sign-in mutation blocking after restart without its native handle', async () => {
  const f = profileServiceFixture();
  const profile = f.service.registry.create(codexSubscription);
  const beforeRestart = runtime(f.options);

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    loginSubscription: async () => ({ loginId: 'login', authUrl: 'https://auth.openai.com/authorize' }),
    probe: async () => verifiedAccount(),
    close: async () => {},
  } as unknown as CodexProfileNative);

  const started = await beforeRestart.request({
    kind: ProfileRequestKind.Authenticate,
    input: {
      action: ProfileAction.SignIn,
      operationId: randomUUID(),
      profileId: profile.id,
      expectedVersion: profile.version,
    },
  });

  if (started.kind !== ProfileRequestKind.Authenticate) {
    throw new Error('unexpected response');
  }

  const afterRestart = runtime(f.options);

  const removal = await afterRestart.request({
    kind: ProfileRequestKind.Mutate,
    mutation: {
      action: ProfileAction.Remove,
      operationId: randomUUID(),
      profileId: profile.id,
      expectedVersion: f.service.registry.get(profile.id).version,
    },
  });

  if (removal.kind !== ProfileRequestKind.Mutate) {
    throw new Error('unexpected removal response');
  }

  expect(removal.data.phase).toBe(ProfileOperationPhase.Removing);
  expect(f.service.operation(started.data.id).phase).toBe(ProfileOperationPhase.AwaitingAuthentication);
  expect(references(f.options, profile.id)).toBe(1);

  await afterRestart.close();
  await beforeRestart.close();
});

it('keeps an enrollment reconcile mutation blocking after restart without its native handle', async () => {
  const f = profileServiceFixture();
  const profile = f.service.registry.create({ ...codexSubscription, authMode: ProfileAuthMode.ApiKey });
  const beforeRestart = runtime(f.options);
  const checkStarted = deferred<void>();
  const checked = deferred<void>();
  let probes = 0;

  vi.spyOn(CodexProfileNative, 'open').mockImplementation(
    async () =>
      ({
        loginApiKey: async () => {},
        probe: async () => {
          probes++;

          if (probes === 1) {
            throw new Error(ErrorCode.REQUEST_FAILED);
          }

          checkStarted.resolve();
          await checked.promise;

          return { ...verifiedAccount(), authMode: ProfileAuthMode.ApiKey };
        },
        close: async () => {},
      }) as unknown as CodexProfileNative,
  );

  const recipient = await beforeRestart.request({ kind: ProfileRequestKind.Recipient });

  if (recipient.kind !== ProfileRequestKind.Recipient) {
    throw new Error('unexpected recipient');
  }

  const operationId = randomUUID();

  const begin = await beforeRestart.request({
    kind: ProfileRequestKind.BeginEnrollment,
    input: {
      operationId,
      profileId: profile.id,
      expectedVersion: profile.version,
      pinnedKeyId: recipient.data.recipientKeyId,
    },
  });

  if (begin.kind !== ProfileRequestKind.BeginEnrollment) {
    throw new Error('unexpected challenge');
  }

  const envelope = await encryptEnrollment(
    begin.data,
    'synthetic-enrollment-key',
    recipient.data.recipientKeyId,
  );

  await beforeRestart.request({ kind: ProfileRequestKind.CompleteEnrollment, input: envelope });
  expect(f.service.operation(operationId).phase).toBe(ProfileOperationPhase.Unknown);

  const reconciling = beforeRestart.request({ kind: ProfileRequestKind.Reconcile, operationId });

  await checkStarted.promise;

  const afterRestart = runtime(f.options);

  const removal = await afterRestart.request({
    kind: ProfileRequestKind.Mutate,
    mutation: {
      action: ProfileAction.Remove,
      operationId: randomUUID(),
      profileId: profile.id,
      expectedVersion: f.service.registry.get(profile.id).version,
    },
  });

  if (removal.kind !== ProfileRequestKind.Mutate) {
    throw new Error('unexpected removal response');
  }

  expect(removal.data.phase).toBe(ProfileOperationPhase.Removing);
  expect(f.service.operation(operationId).phase).toBe(ProfileOperationPhase.Unknown);
  expect(references(f.options, profile.id)).toBe(1);

  checked.resolve();
  await reconciling.catch(() => undefined);
  await afterRestart.close();
  await beforeRestart.close();
});
