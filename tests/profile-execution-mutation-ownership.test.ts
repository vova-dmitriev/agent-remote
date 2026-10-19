import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { encryptEnrollment } from '@transport/credentials/sealed-box.js';
import { managedCodexSocketExited } from '../apps/daemon/src/codex/launcher.js';
import { ProfileExecutionOwnership } from '../apps/daemon/src/profiles/runtime/execution/execution-ownership.js';
import { ExecutionChildState } from '../apps/daemon/src/profiles/runtime/execution/execution-values.js';
import { ProfileService } from '../apps/daemon/src/profiles/service.js';
import { RuntimeProfiles } from '../apps/daemon/src/runtime/services/runtime-profiles.js';
import { profileServiceFixture } from './profiles/service.fixture.js';
import { codexSubscription, verifiedAccount } from './profiles/registry.fixture.js';

it('keeps a credential mutation reservation across recreation and rejects execution until terminal', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);
  const ownership = new ProfileExecutionOwnership(options.database, options.scope, service.registry);
  const operationId = randomUUID();
  const mutation = ownership.reserveMutation(profile.id, profile.version, operationId);

  expect(() => ownership.reserve(profile.id, profile.version)).toThrow('PROFILE_EXECUTION_ACTIVE');

  const recovered = new ProfileExecutionOwnership(options.database, options.scope, service.registry);

  expect(recovered.isActive(profile.id)).toBe(true);
  expect(() => recovered.reserve(profile.id, profile.version)).toThrow('PROFILE_EXECUTION_ACTIVE');
  expect(mutation.releaseTerminal()).toBe(true);
  expect(recovered.reserve(profile.id, profile.version)).toBeDefined();
});

it('does not release a persisted execution when the socket is absent but the owned child is live', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);
  const ownership = new ProfileExecutionOwnership(options.database, options.scope, service.registry);
  const lease = ownership.reserve(profile.id, profile.version);

  lease.bindSocket('/synthetic/profile/app-server.sock');
  lease.bindProcess(91234);
  lease.markReady();

  expect(await managedCodexSocketExited(join(options.directory, 'missing-profile-socket'))).toBe(true);

  const recovered = new ProfileExecutionOwnership(options.database, options.scope, service.registry);

  await recovered.reconcileExited(async (pid) =>
    pid === 91234 ? ExecutionChildState.Unverified : ExecutionChildState.Unknown,
  );

  expect(recovered.isActive(profile.id)).toBe(true);

  await recovered.reconcileExited(async () => ExecutionChildState.Exited);
  expect(recovered.isActive(profile.id)).toBe(false);
});

it('blocks execution while enrollment is held inside native verification', async () => {
  const { options } = profileServiceFixture();

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: 'synthetic-codex' },
  });

  const created = await runtime.request({
    kind: 'mutate',
    mutation: {
      action: 'create_profile',
      operationId: randomUUID(),
      input: { ...codexSubscription, authMode: 'api_key' },
    },
  });

  if (created.kind !== 'mutate') {
    throw new Error('unexpected profile mutation result');
  }

  const internals = runtime as unknown as {
    service: ProfileService;
    native: { verify: (profile: unknown, current: () => boolean, secret?: string) => Promise<unknown> };
    enrollment: {
      recipient: () => Promise<{ recipientKeyId: string }>;
      begin: (request: unknown) => Promise<unknown>;
      complete: (payload: unknown) => Promise<unknown>;
    };
  };

  const profile = internals.service.registry.verify(created.data.profileId, 1, {
    ...verifiedAccount(),
    authMode: 'api_key',
    identity: { accountRef: 'synthetic-initial-key', verifiedAt: 1000 },
  });

  const request = {
    operationId: randomUUID(),
    profileId: profile.id,
    expectedVersion: profile.version,
    pinnedKeyId: 'a'.repeat(64),
  };

  const recipient = await internals.enrollment.recipient();

  request.pinnedKeyId = recipient.recipientKeyId;
  const begin = await runtime.request({ kind: 'begin_enrollment', input: request });

  if (begin.kind !== 'begin_enrollment') {
    throw new Error('unexpected enrollment result');
  }

  const encrypted = await encryptEnrollment(
    begin.data,
    'synthetic-enrolled-key',
    recipient.recipientKeyId,
    Date.now(),
  );

  let releaseNative!: (value: unknown) => void;
  let enteredNative!: () => void;

  const nativeEntered = new Promise<void>((resolve) => {
    enteredNative = resolve;
  });

  const nativeRelease = new Promise<unknown>((resolve) => {
    releaseNative = resolve;
  });

  internals.native.verify = async () => {
    enteredNative();

    return nativeRelease;
  };

  const completion = runtime.request({ kind: 'complete_enrollment', input: encrypted });

  await nativeEntered;

  expect(() =>
    runtime.prepareExecution(
      {
        profileId: profile.id,
        provider: 'codex',
        model: 'synthetic-model',
      },
      profile.version,
    ),
  ).toThrow('PROFILE_EXECUTION_ACTIVE');

  releaseNative({
    ...verifiedAccount(),
    authMode: 'api_key',
    identity: {
      accountRef: `codex-key:${createHash('sha256').update('synthetic-enrolled-key').digest('hex')}`,
      verifiedAt: Date.now(),
    },
  });

  await completion;
  await runtime.close();
});
