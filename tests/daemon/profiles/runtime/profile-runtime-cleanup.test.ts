import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfileAction, ProfileAuthMode, ProfileOperationPhase, ProfileRequestKind } from '@protocol';
import { CodexProfileNative } from '@daemon/profiles/native/codex.js';
import { RuntimeProfiles } from '@daemon/runtime/services/runtime-profiles.js';
import { encryptEnrollment } from '@transport/credentials/sealed-box.js';
import { profileServiceFixture } from '../fixtures/service.fixture.js';
import { codexSubscription, verifiedAccount } from '../fixtures/registry.fixture.js';
import { deferred } from '../fixtures/runtime/deferred.js';
import { RuntimeProfileNative } from '@daemon/profiles/runtime/native/native.js';

afterEach(() => vi.restoreAllMocks());

it('keeps concurrent removal reconciliations pending until the native verification child exits', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create({ ...codexSubscription, authMode: ProfileAuthMode.ApiKey });

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  const closing = deferred<void>();
  const exit = deferred<void>();

  const close = vi.fn(async () => {
    closing.resolve();
    await exit.promise;
  });

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    loginApiKey: async () => {},
    probe: async () => ({ ...verifiedAccount(), authMode: ProfileAuthMode.ApiKey }),
    close,
  } as unknown as CodexProfileNative);

  const recipient = await runtime.request({ kind: ProfileRequestKind.Recipient });

  if (recipient.kind !== ProfileRequestKind.Recipient) {
    throw new Error('unexpected recipient');
  }

  const enrollmentId = randomUUID();

  const begin = await runtime.request({
    kind: ProfileRequestKind.BeginEnrollment,
    input: {
      operationId: enrollmentId,
      profileId: profile.id,
      expectedVersion: profile.version,
      pinnedKeyId: recipient.data.recipientKeyId,
    },
  });

  if (begin.kind !== ProfileRequestKind.BeginEnrollment) {
    throw new Error('unexpected challenge');
  }

  const input = await encryptEnrollment(
    begin.data,
    'synthetic-cleanup-credential',
    recipient.data.recipientKeyId,
  );

  const verification = runtime.request({ kind: ProfileRequestKind.CompleteEnrollment, input });

  await closing.promise;
  const operationId = randomUUID();
  let removals = 0;

  const remove = runtime
    .request({
      kind: ProfileRequestKind.Mutate,
      mutation: {
        action: ProfileAction.Remove,
        operationId,
        profileId: profile.id,
        expectedVersion: service.registry.get(profile.id).version,
      },
    })
    .then((value) => {
      removals++;

      return value;
    });

  const reconcile = runtime.request({ kind: ProfileRequestKind.Reconcile, operationId }).then((value) => {
    removals++;

    return value;
  });

  try {
    const acknowledged = await Promise.race([
      Promise.all([remove, reconcile]).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);

    expect(acknowledged).toBe(false);
    expect(removals).toBe(0);
    expect(close).toHaveBeenCalledOnce();

    exit.resolve();
    await Promise.allSettled([verification, remove, reconcile]);

    expect(removals).toBe(2);
    expect(service.list().profiles).toHaveLength(0);

    const enrollment = await runtime.request({
      kind: ProfileRequestKind.Operation,
      operationId: enrollmentId,
    });

    expect(enrollment.kind).toBe(ProfileRequestKind.Operation);

    if (enrollment.kind === ProfileRequestKind.Operation) {
      expect(enrollment.data.phase).toBe(ProfileOperationPhase.Failed);
    }

    const references = options.database.connection
      .prepare('SELECT COUNT(*) AS count FROM profile_execution_refs WHERE profile=?')
      .get(profile.id) as { count: number };

    expect(references.count).toBe(0);

    const recorded = await runtime.request({ kind: ProfileRequestKind.Operation, operationId });

    expect(recorded.kind).toBe(ProfileRequestKind.Operation);

    if (recorded.kind === ProfileRequestKind.Operation) {
      expect(recorded.data.phase).toBe(ProfileOperationPhase.Complete);
    }

    await expect(
      runtime.request({ kind: ProfileRequestKind.Reconcile, operationId: randomUUID() }),
    ).rejects.toThrow('NOT_FOUND');
  } finally {
    exit.resolve();
    await Promise.allSettled([verification, remove, reconcile]);
    await runtime.close();
  }
});

it('tracks an opening native child through concurrent closes and shares its exit promise', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);

  const native = new RuntimeProfileNative(
    { ...options, inputEnabled: true, baseEnvironment: {}, native: { executable: process.execPath } },
    service.registry,
  );

  const opening = deferred<CodexProfileNative>();
  const exit = deferred<void>();
  const close = vi.fn(() => exit.promise);
  const open = vi.spyOn(CodexProfileNative, 'open').mockReturnValue(opening.promise);
  const verifying = native.verify(profile, () => true);

  await expect.poll(() => open.mock.calls.length).toBe(1);
  const first = native.closeProfile(profile.id);
  const second = native.closeProfile(profile.id);

  opening.resolve({ probe: async () => verifiedAccount(), close } as unknown as CodexProfileNative);
  await expect.poll(() => close.mock.calls.length).toBe(1);
  exit.resolve();
  await Promise.all([verifying, first, second]);
  expect(close).toHaveBeenCalledOnce();
});
