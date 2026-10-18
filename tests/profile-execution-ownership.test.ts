import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { ProfileExecutionOwnership } from '../apps/daemon/src/profiles/runtime/execution-ownership.js';
import { ExecutionChildState } from '../apps/daemon/src/profiles/runtime/execution-values.js';
import { ProfileService } from '../apps/daemon/src/profiles/service.js';
import { RuntimeProfiles } from '../apps/daemon/src/profiles/runtime/service.js';
import { profileServiceFixture } from './profiles/service.fixture.js';
import { codexSubscription, verifiedAccount } from './profiles/registry.fixture.js';

it('persists a live execution reference and blocks credential-changing lifecycle operations', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);
  const ownership = new ProfileExecutionOwnership(options.database, options.scope, service.registry);
  const lease = ownership.reserve(profile.id, profile.version);

  lease.bindSocket('/synthetic/profile/app-server.sock');
  lease.bindProcess(91235);
  lease.markReady();

  const protectedService = new ProfileService({
    ...options,
    executionActive: (profileId) => ownership.isActive(profileId),
  });

  await expect(
    protectedService.execute({
      operationId: randomUUID(),
      action: 'disable_profile',
      profileId: profile.id,
      expectedVersion: profile.version,
    }),
  ).rejects.toThrow('PROFILE_EXECUTION_ACTIVE');

  const recovered = new ProfileExecutionOwnership(options.database, options.scope, service.registry);

  expect(recovered.isActive(profile.id)).toBe(true);
  await recovered.reconcileExited(async () => ExecutionChildState.Exited);
  expect(recovered.isActive(profile.id)).toBe(false);
  protectedService.registry.update(profile.id, profile.version, { enabled: false });
});

it('rejects sign-in and credential enrollment while the selected profile has a live execution', async () => {
  const { options } = profileServiceFixture();

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: 'synthetic-codex' },
  });

  const created = await runtime.request({
    kind: 'mutate',
    mutation: { action: 'create_profile', operationId: randomUUID(), input: codexSubscription },
  });

  if (created.kind !== 'mutate') {
    throw new Error('unexpected profile mutation result');
  }

  const service = (runtime as unknown as { service: ProfileService }).service;
  const profile = service.registry.verify(created.data.profileId, 1, verifiedAccount());
  const ownership = new ProfileExecutionOwnership(options.database, options.scope, service.registry);

  ownership.reserve(profile.id, profile.version);

  await expect(
    runtime.request({
      kind: 'authenticate',
      input: {
        action: 'sign_in_profile',
        operationId: randomUUID(),
        profileId: profile.id,
        expectedVersion: profile.version,
      },
    }),
  ).rejects.toThrow('PROFILE_EXECUTION_ACTIVE');

  await expect(
    runtime.request({
      kind: 'begin_enrollment',
      input: {
        operationId: randomUUID(),
        profileId: profile.id,
        expectedVersion: profile.version,
        pinnedKeyId: 'a'.repeat(64),
      },
    }),
  ).rejects.toThrow('PROFILE_EXECUTION_ACTIVE');

  await runtime.close();
});

it('reserves before asynchronous preparation and preserves the reference when launch outcome is uncertain', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);
  const ownership = new ProfileExecutionOwnership(options.database, options.scope, service.registry);
  const lease = ownership.reserve(profile.id, profile.version);

  expect(ownership.isActive(profile.id)).toBe(true);

  const recovered = new ProfileExecutionOwnership(options.database, options.scope, service.registry);

  expect(recovered.isActive(profile.id)).toBe(true);
  await recovered.reconcileExited(async () => ExecutionChildState.Exited);
  expect(recovered.isActive(profile.id)).toBe(true);
  expect(lease.releaseBeforeLaunch()).toBe(true);
});

it('does not adopt a recovered same-profile socket PID that may have been reused', async () => {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);
  const socketPath = '/synthetic/profile/shared-app-server.sock';
  const original = new ProfileExecutionOwnership(options.database, options.scope, service.registry);
  const originalLease = original.reserve(profile.id, profile.version);

  originalLease.bindSocket(socketPath);
  originalLease.bindProcess(91236);

  const recovered = new ProfileExecutionOwnership(options.database, options.scope, service.registry);
  const recoveredLease = recovered.reserve(profile.id, profile.version);

  recoveredLease.bindSocket(socketPath);

  expect(recoveredLease.processId()).toBeUndefined();

  await recovered.reconcileExited(async (pid) =>
    pid === 91236 ? ExecutionChildState.Unverified : ExecutionChildState.Unknown,
  );

  expect(recovered.isActive(profile.id)).toBe(true);
  expect(recoveredLease.processId()).toBeUndefined();
});
