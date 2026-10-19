import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorCode, ProfileAuthMode, ProfileOperationPhase, ProfileRequestKind } from '@protocol';
import { encryptEnrollment } from '@transport/credentials/sealed-box.js';
import { CodexProfileNative } from '../apps/daemon/src/profiles/native/codex.js';
import { ProfileProcessCleanupError } from '../apps/daemon/src/profiles/native/lifecycle/errors.js';
import { RuntimeProfiles } from '../apps/daemon/src/profiles/runtime/service.js';
import { RuntimeProfileNative } from '../apps/daemon/src/profiles/runtime/native.js';
import { codexSubscription, verifiedAccount } from './profiles/registry.fixture.js';
import { profileServiceFixture } from './profiles/service.fixture.js';

afterEach(() => vi.restoreAllMocks());

it('rejects a native verification while the previous child exit is unconfirmed', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);

  const native = new RuntimeProfileNative(
    { ...options, inputEnabled: true, baseEnvironment: {}, native: { executable: process.execPath } },
    service.registry,
  );

  const open = vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    probe: async () => verifiedAccount(),
    close: async () => {
      throw new ProfileProcessCleanupError();
    },
  } as unknown as CodexProfileNative);

  await expect(native.verify(profile, () => true)).rejects.toThrow(ErrorCode.REQUEST_TIMEOUT);
  await expect(native.verify(profile, () => true)).rejects.toThrow(ErrorCode.PROFILE_EXECUTION_ACTIVE);
  expect(open).toHaveBeenCalledOnce();
});

it('reserves proof capacity before opening and preserves an earlier recovery proof', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);

  const native = new RuntimeProfileNative(
    { ...options, inputEnabled: true, baseEnvironment: {}, native: { executable: process.execPath } },
    service.registry,
    1,
  );

  let opens = 0;

  const open = vi.spyOn(CodexProfileNative, 'open').mockImplementation(async () => {
    opens++;

    return {
      probe: async () => {
        if (opens === 1) {
          throw new Error(ErrorCode.REQUEST_FAILED);
        }

        return verifiedAccount();
      },
      close: async () => {},
    } as unknown as CodexProfileNative;
  });

  await expect(native.verify(profile, () => true, undefined, 'earlier-operation')).rejects.toThrow(
    ErrorCode.REQUEST_FAILED,
  );

  expect(native.hasCloseProof('earlier-operation', profile.id, profile.version)).toBe(true);

  await expect(native.verify(profile, () => true, undefined, 'later-operation')).rejects.toThrow(
    ErrorCode.PROFILE_LIMIT_REACHED,
  );

  expect(open).toHaveBeenCalledOnce();
  expect(native.hasCloseProof('earlier-operation', profile.id, profile.version)).toBe(true);

  native.forgetCloseProof('earlier-operation');
  await native.verify(profile, () => true, undefined, 'later-operation');
  expect(open).toHaveBeenCalledTimes(2);
});

it('keeps enrollment unknown after cleanup failure instead of reconciling through a second child', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create({ ...codexSubscription, authMode: ProfileAuthMode.ApiKey });

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  const open = vi.spyOn(CodexProfileNative, 'open').mockImplementation(async () => {
    const call = open.mock.calls.length;

    return {
      loginApiKey: async () => {},
      probe: async () => ({ ...verifiedAccount(), authMode: ProfileAuthMode.ApiKey }),
      close: async () => {
        if (call === 1) {
          throw new ProfileProcessCleanupError();
        }
      },
    } as unknown as CodexProfileNative;
  });

  try {
    const recipient = await runtime.request({ kind: ProfileRequestKind.Recipient });

    if (recipient.kind !== ProfileRequestKind.Recipient) {
      throw new Error('unexpected recipient');
    }

    const operationId = randomUUID();

    const begin = await runtime.request({
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

    const input = await encryptEnrollment(
      begin.data,
      'synthetic-enrollment-key',
      recipient.data.recipientKeyId,
    );

    const completed = await runtime.request({ kind: ProfileRequestKind.CompleteEnrollment, input });

    expect(completed.kind).toBe(ProfileRequestKind.CompleteEnrollment);
    expect(service.operation(operationId).phase).toBe(ProfileOperationPhase.Unknown);

    const reconciled = await runtime.request({ kind: ProfileRequestKind.Reconcile, operationId });

    expect(reconciled.kind).toBe(ProfileRequestKind.Reconcile);
    expect(service.operation(operationId).phase).toBe(ProfileOperationPhase.Unknown);
    expect(open).toHaveBeenCalledOnce();

    const restarted = new RuntimeProfiles({
      ...options,
      inputEnabled: true,
      baseEnvironment: {},
      native: { executable: process.execPath },
    });

    try {
      const afterRestart = await restarted.request({ kind: ProfileRequestKind.Reconcile, operationId });

      expect(afterRestart.kind).toBe(ProfileRequestKind.Reconcile);
      expect(service.operation(operationId).phase).toBe(ProfileOperationPhase.Unknown);
      expect(open).toHaveBeenCalledOnce();
    } finally {
      await restarted.close();
    }

    const references = options.database.connection
      .prepare('SELECT COUNT(*) AS count FROM profile_execution_refs WHERE profile=?')
      .get(profile.id) as { count: number };

    expect(references.count).toBe(1);
  } finally {
    await runtime.close().catch(() => undefined);
  }
});
