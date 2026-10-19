import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  ProfileAction,
  ProfileAuthMode,
  ProfileOperationPhase,
  ProfileRequestKind,
  type ProfileOperation,
} from '@protocol';
import { encryptEnrollment } from '@transport/credentials/sealed-box.js';
import { ProfileJournal } from '../apps/daemon/src/profiles/lifecycle/journal.js';
import { CodexProfileNative } from '../apps/daemon/src/profiles/native/codex.js';
import { RuntimeProfiles } from '../apps/daemon/src/runtime/services/runtime-profiles.js';
import { codexSubscription, verifiedAccount } from './profiles/registry.fixture.js';
import { profileServiceFixture } from './profiles/service.fixture.js';

afterEach(() => vi.restoreAllMocks());

it('allows removal after enrollment is Unknown but its child closed positively', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create({ ...codexSubscription, authMode: ProfileAuthMode.ApiKey });

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  let failCompletion = true;
  const save = ProfileJournal.prototype.save;

  vi.spyOn(ProfileJournal.prototype, 'save').mockImplementation(function (
    this: ProfileJournal,
    operation: ProfileOperation,
  ) {
    if (
      operation.action === ProfileAction.EnrollApiKey &&
      operation.phase === ProfileOperationPhase.Complete &&
      failCompletion
    ) {
      failCompletion = false;
      throw new Error(ErrorCode.REQUEST_FAILED);
    }

    return save.call(this, operation);
  });

  vi.spyOn(CodexProfileNative, 'open').mockResolvedValue({
    loginApiKey: async () => {},
    probe: async () => ({ ...verifiedAccount(), authMode: ProfileAuthMode.ApiKey }),
    close: async () => {},
  } as unknown as CodexProfileNative);

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

    await runtime.request({ kind: ProfileRequestKind.CompleteEnrollment, input });
    expect(service.operation(operationId).phase).toBe(ProfileOperationPhase.Unknown);

    const removed = await runtime.request({
      kind: ProfileRequestKind.Mutate,
      mutation: {
        action: ProfileAction.Remove,
        operationId: randomUUID(),
        profileId: profile.id,
        expectedVersion: service.registry.get(profile.id).version,
      },
    });

    expect(removed.kind).toBe(ProfileRequestKind.Mutate);
    expect(service.operation(operationId).phase).toBe(ProfileOperationPhase.Failed);

    const references = options.database.connection
      .prepare('SELECT COUNT(*) AS count FROM profile_execution_refs WHERE profile=?')
      .get(profile.id) as { count: number };

    expect(references.count).toBe(0);
  } finally {
    await runtime.close().catch(() => undefined);
  }
});
