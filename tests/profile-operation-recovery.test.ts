import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { ProfileService } from '../apps/daemon/src/profiles/service.js';
import { codexSubscription } from './profiles/registry.fixture.js';
import { profileServiceFixture as fixture } from './profiles/service.fixture.js';

it('does not acknowledge credential cleanup after its caller was revoked', async () => {
  let authorized = true;

  const { service } = fixture(async () => {
    authorized = false;
  });

  const created = await service.execute({
    operationId: randomUUID(),
    action: 'create_profile',
    input: codexSubscription,
  });

  const id = randomUUID();

  await expect(
    service.execute(
      { operationId: id, action: 'remove_profile', profileId: created.profileId, expectedVersion: 1 },
      () => authorized,
    ),
  ).rejects.toThrow('UNAUTHORIZED');

  expect(service.registry.get(created.profileId).status).toBe('removing');
  expect(service.operation(id).phase).toBe('removing');
});

it('reconciles concurrent acknowledged cleanup without incrementing the tombstone twice', async () => {
  let release!: () => void;

  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });

  const { service, options } = fixture(async () => barrier);

  const created = await service.execute({
    operationId: randomUUID(),
    action: 'create_profile',
    input: codexSubscription,
  });

  const id = randomUUID();

  const first = service.execute({
    operationId: id,
    action: 'remove_profile',
    profileId: created.profileId,
    expectedVersion: 1,
  });

  const second = new ProfileService(options).reconcile(id);

  release();
  const [a, b] = await Promise.all([first, second]);

  expect(a).toEqual(b);
  expect(a.phase).toBe('complete');
  expect(service.registry.get(created.profileId).version).toBe(3);
});

it('captures its owner scope instead of observing a mutable caller object', async () => {
  const { service, options } = fixture();

  const created = await service.execute({
    operationId: randomUUID(),
    action: 'create_profile',
    input: codexSubscription,
  });

  options.scope.ownerId = 'later-unrelated-owner';
  expect(service.operation(created.id).ownerId).toBe('owner-a');

  const renamed = await service.execute({
    operationId: randomUUID(),
    action: 'rename_profile',
    profileId: created.profileId,
    expectedVersion: 1,
    label: 'Original owner',
  });

  expect(renamed.ownerId).toBe('owner-a');
  expect(service.list().profiles[0]?.label).toBe('Original owner');
});
