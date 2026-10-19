import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfileAction, ProfileOperationPhase, ProfileRequestKind } from '@protocol';
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

it('keeps a persisted Check mutation blocking after restart without its native handle', async () => {
  const f = profileServiceFixture();
  const profile = f.service.registry.create(codexSubscription);
  const ready = f.service.registry.verify(profile.id, profile.version, verifiedAccount());
  const beforeRestart = runtime(f.options);
  const probing = deferred<void>();
  const probeResult = deferred<ReturnType<typeof verifiedAccount>>();

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    loginSubscription: async () => ({ loginId: 'login', authUrl: 'https://auth.openai.com/authorize' }),
    probe: async () => {
      probing.resolve();

      return probeResult.promise;
    },
    close: async () => {},
  } as unknown as CodexProfileNative);

  const checking = beforeRestart.request({
    kind: ProfileRequestKind.Authenticate,
    input: {
      action: ProfileAction.Check,
      operationId: randomUUID(),
      profileId: profile.id,
      expectedVersion: ready.version,
    },
  });

  await probing.promise;
  const check = f.service.list().operations.find((operation) => operation.action === ProfileAction.Check);

  if (!check) {
    throw new Error('expected persisted Check operation');
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
  expect(f.service.operation(check.id).phase).toBe(ProfileOperationPhase.Preparing);

  expect(
    (
      f.options.database.connection
        .prepare('SELECT COUNT(*) AS count FROM profile_execution_refs WHERE profile=?')
        .get(profile.id) as { count: number }
    ).count,
  ).toBe(1);

  probeResult.resolve(verifiedAccount());
  await checking.catch(() => undefined);
  await afterRestart.close();
  await beforeRestart.close();
});
