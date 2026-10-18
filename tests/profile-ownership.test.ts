import { expect, it } from 'vitest';
import { codexSubscription, profileRegistryFixture, verifiedAccount } from './profiles/registry.fixture.js';

it.each([
  ['owner-b', 'mac-a'],
  ['owner-a', 'mac-b'],
])('fences profile metadata and all mutations for %s/%s', (owner, device) => {
  const { open } = profileRegistryFixture();
  const registry = open();
  const created = registry.create(codexSubscription);
  const ready = registry.verify(created.id, 1, verifiedAccount());
  const foreign = open(owner, device);

  expect(foreign.list()).toEqual([]);
  expect(foreign.defaultFor('codex')).toBeNull();

  for (const mutation of [
    () => foreign.get(ready.id),
    () => foreign.update(ready.id, ready.version, { label: 'Foreign' }),
    () => foreign.verify(ready.id, ready.version, verifiedAccount()),
    () => foreign.setDefault(ready.id, ready.version),
    () => foreign.beginRemoval(ready.id, ready.version),
    () => foreign.completeRemoval(ready.id, ready.version),
  ]) {
    expect(mutation).toThrow('NOT_FOUND');
  }

  expect(registry.get(ready.id)).toEqual(ready);
});

it('rejects secrets, runtime paths and environment overlays instead of serializing them', () => {
  const registry = profileRegistryFixture().open();

  for (const field of ['apiKey', 'token', 'runtimeHome', 'env', 'ownerId', 'deviceId']) {
    expect(() => registry.create({ ...codexSubscription, [field]: 'synthetic-private' } as never)).toThrow();
  }

  const profile = registry.create(codexSubscription);

  expect(() =>
    registry.verify(profile.id, 1, { ...verifiedAccount(), apiKey: 'synthetic-private' } as never),
  ).toThrow();

  expect(JSON.stringify(registry.list())).not.toContain('synthetic-private');

  expect(Object.keys(registry.get(profile.id)).sort()).toEqual([
    'authMode',
    'capabilities',
    'deviceId',
    'id',
    'identity',
    'label',
    'models',
    'ownerId',
    'provider',
    'status',
    'updatedAt',
    'version',
  ]);
});
