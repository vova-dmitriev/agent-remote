import { CodedError } from '@protocol';
import { randomUUID } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { profileServiceFixture as fixture } from './fixtures/service.fixture.js';
import { ProfileService } from '@daemon/profiles/service.js';
import { buildProfileEnvironment } from '@daemon/profiles/environment.js';
import { codexSubscription, verifiedAccount } from './fixtures/registry.fixture.js';

it('reconciles a lost create acknowledgment by its original ID across service restart', async () => {
  const { service, options } = fixture();
  const request = { operationId: randomUUID(), action: 'create_profile' as const, input: codexSubscription };
  const receipt = await service.execute(request);
  const restored = new ProfileService(options);

  expect(await restored.execute(request)).toEqual(receipt);
  expect(restored.operation(request.operationId)).toEqual(receipt);
  expect(restored.list().profiles).toHaveLength(1);

  await expect(
    restored.execute({ ...request, input: { ...codexSubscription, label: 'Changed replay' } }),
  ).rejects.toThrow('PROFILE_OPERATION_REUSED');

  expect(restored.list().profiles[0]?.label).toBe('OpenAI Personal');
});

it('persists rename/disable/default with exact version fencing and idempotent receipts', async () => {
  const { service, options } = fixture();

  const created = await service.execute({
    operationId: randomUUID(),
    action: 'create_profile',
    input: codexSubscription,
  });

  const ready = service.registry.verify(created.profileId, 1, verifiedAccount());

  await service.execute({
    operationId: randomUUID(),
    action: 'set_default_profile',
    profileId: ready.id,
    expectedVersion: 2,
  });

  expect(new ProfileService(options).list().defaults.codex).toBe(ready.id);

  const rename = {
    operationId: randomUUID(),
    action: 'rename_profile' as const,
    profileId: ready.id,
    expectedVersion: 2,
    label: 'Work',
  };

  await service.execute(rename);
  await service.execute(rename);
  expect(service.registry.get(ready.id).version).toBe(3);

  await expect(service.execute({ ...rename, operationId: randomUUID() })).rejects.toThrow(
    'LOCAL_REVISION_CONFLICT',
  );

  await service.execute({
    operationId: randomUUID(),
    action: 'disable_profile',
    profileId: ready.id,
    expectedVersion: 3,
  });

  expect(new ProfileService(options).list().defaults.codex).toBeNull();
  expect(service.list().profiles[0]?.status).toBe('disabled');
});

it('keeps deletion pending until the Mac acknowledges cleanup, then reconciles once', async () => {
  let available = false;

  const { service, options } = fixture(async () => {
    if (!available) {
      throw new CodedError('DEVICE_OFFLINE');
    }
  });

  const created = await service.execute({
    operationId: randomUUID(),
    action: 'create_profile',
    input: codexSubscription,
  });

  const request = {
    operationId: randomUUID(),
    action: 'remove_profile' as const,
    profileId: created.profileId,
    expectedVersion: 1,
  };

  const pending = await service.execute(request);

  expect(pending.phase).toBe('removing');
  expect(pending.code).toBe('DEVICE_OFFLINE');
  expect(service.list().profiles).toMatchObject([{ id: created.profileId, status: 'removing' }]);
  expect(service.operation(request.operationId).phase).toBe('removing');
  available = true;
  const restarted = new ProfileService(options);
  const complete = await restarted.reconcile(request.operationId);

  expect(complete.phase).toBe('complete');
  expect(await restarted.execute(request)).toEqual(complete);
  expect(restarted.list().profiles).toEqual([]);
});

it('removes only the selected native credential and preserves sibling credentials and histories', async () => {
  const { service, directory } = fixture();
  const first = service.registry.create(codexSubscription);
  const second = service.registry.create(codexSubscription);

  const a = await buildProfileEnvironment(service.registry, first.id, {
    directory,
    base: {},
    purpose: 'enrollment',
  });

  const b = await buildProfileEnvironment(service.registry, second.id, {
    directory,
    base: {},
    purpose: 'enrollment',
  });

  const firstKey = join(a.CODEX_HOME!, 'auth.json');
  const siblingKey = join(b.CODEX_HOME!, 'auth.json');
  const history = join(a.CODEX_HOME!, 'synthetic-history.txt');

  for (const path of [firstKey, siblingKey, history]) {
    writeFileSync(path, 'synthetic-private-file', { mode: 0o600 });
  }

  const receipt = await service.execute({
    operationId: randomUUID(),
    action: 'remove_profile',
    profileId: first.id,
    expectedVersion: 1,
  });

  expect(receipt.phase).toBe('complete');
  expect(existsSync(firstKey)).toBe(false);
  expect(existsSync(siblingKey)).toBe(true);
  expect(existsSync(history)).toBe(true);
});

it('fences operation receipts and mutations by owner/device before observing a saved operation', async () => {
  const { service, options } = fixture();

  const created = await service.execute({
    operationId: randomUUID(),
    action: 'create_profile',
    input: codexSubscription,
  });

  const foreign = new ProfileService({ ...options, scope: { ownerId: 'other-owner', deviceId: 'mac-a' } });

  expect(foreign.list().profiles).toEqual([]);
  expect(() => foreign.operation(created.id)).toThrow('NOT_FOUND');

  await expect(
    foreign.execute({
      operationId: randomUUID(),
      action: 'rename_profile',
      profileId: created.profileId,
      expectedVersion: 1,
      label: 'Foreign',
    }),
  ).rejects.toThrow('NOT_FOUND');

  expect(service.registry.get(created.profileId).label).toBe('OpenAI Personal');
});

it('validates a stored profile again whenever its stored text changes', () => {
  const { options, service } = fixture();
  const profile = service.registry.create({ ...codexSubscription, label: 'Synthetic' });
  const rows = options.database.connection;

  expect(service.list().profiles.map((item) => item.label)).toEqual(['Synthetic']);

  rows
    .prepare('UPDATE execution_profiles SET value=? WHERE id=?')
    .run(JSON.stringify({ ...profile, label: 'Renamed' }), profile.id);

  expect(service.list().profiles.map((item) => item.label)).toEqual(['Renamed']);

  // A read never hands out a profile the cache shares: changing it changes nothing stored.
  service.list().profiles[0]!.label = 'Mutated';
  expect(service.list().profiles[0]!.label).toBe('Renamed');

  rows
    .prepare('UPDATE execution_profiles SET value=? WHERE id=?')
    .run(JSON.stringify({ ...profile, ownerId: 'owner-b' }), profile.id);

  expect(() => service.list()).toThrow(CodedError);
});
