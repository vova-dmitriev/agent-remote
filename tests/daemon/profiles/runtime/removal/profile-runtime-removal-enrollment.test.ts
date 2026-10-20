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
import { CodexProfileNative } from '../../../../../apps/daemon/src/profiles/native/codex.js';
import { RuntimeProfiles } from '../../../../../apps/daemon/src/runtime/services/runtime-profiles.js';
import { deferred } from '../../fixtures/runtime/deferred.js';
import { codexSubscription, verifiedAccount } from '../../fixtures/registry.fixture.js';
import { profileServiceFixture } from '../../fixtures/service.fixture.js';

afterEach(() => vi.restoreAllMocks());

function runtimeFixture() {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create({ ...codexSubscription, authMode: ProfileAuthMode.ApiKey });

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

it('terminalizes unknown enrollment reconciliation only after its native check closes', async () => {
  const f = runtimeFixture();
  const checkStarted = deferred<void>();
  const checked = deferred<void>();
  const closeStarted = deferred<void>();
  const closing = deferred<void>();
  let probes = 0;
  let closes = 0;

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
        close: async () => {
          closes++;

          if (closes > 1) {
            closeStarted.resolve();
            await closing.promise;
          }
        },
      }) as unknown as CodexProfileNative,
  );

  try {
    const recipient = await f.runtime.request({ kind: ProfileRequestKind.Recipient });

    if (recipient.kind !== ProfileRequestKind.Recipient) {
      throw new Error('unexpected recipient');
    }

    const operationId = randomUUID();

    const begin = await f.runtime.request({
      kind: ProfileRequestKind.BeginEnrollment,
      input: {
        operationId,
        profileId: f.profile.id,
        expectedVersion: f.profile.version,
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

    const uncertain = await f.runtime.request({
      kind: ProfileRequestKind.CompleteEnrollment,
      input: envelope,
    });

    expect(uncertain.kind).toBe(ProfileRequestKind.CompleteEnrollment);
    expect(f.service.operation(operationId).phase).toBe(ProfileOperationPhase.Unknown);

    const reconciling = f.runtime.request({ kind: ProfileRequestKind.Reconcile, operationId });

    await checkStarted.promise;

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
    expect(f.service.operation(operationId).phase).toBe(ProfileOperationPhase.Unknown);
    expect(referenceCount(f.options, f.profile.id)).toBe(1);

    checked.resolve();
    closing.resolve();
    const [removeResult] = await Promise.all([removing, reconciling.catch(() => undefined)]);

    expect(removeResult.kind).toBe(ProfileRequestKind.Mutate);
    expect(f.service.operation(operationId).phase).toBe(ProfileOperationPhase.Failed);
    expect(referenceCount(f.options, f.profile.id)).toBe(0);
  } finally {
    checked.resolve();
    closing.resolve();
    await f.runtime.close().catch(() => undefined);
  }
});
