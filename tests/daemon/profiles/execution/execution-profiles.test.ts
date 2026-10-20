import { expect, it } from 'vitest';
import { codexSubscription, profileRegistryFixture, verifiedAccount } from '../fixtures/registry.fixture.js';

it('retains two subscription identities and a default across a registry restart', () => {
  const { open } = profileRegistryFixture();
  const registry = open();
  const first = registry.create(codexSubscription);
  const second = registry.create({ ...codexSubscription, label: 'OpenAI Work' });

  expect(first).toMatchObject({ status: 'needs_authentication', identity: null, version: 1 });
  expect(first.id).not.toBe(second.id);
  const personal = registry.verify(first.id, 1, verifiedAccount());
  const work = registry.verify(second.id, 1, verifiedAccount('synthetic-account-b', 'workspace-b'));

  registry.setDefault(work.id, work.version);
  const restarted = open();

  expect(restarted.list()).toHaveLength(2);
  expect(restarted.get(personal.id).identity?.accountRef).toBe('synthetic-account-a');
  expect(restarted.defaultFor('codex')?.identity?.accountRef).toBe('synthetic-account-b');

  expect(
    restarted
      .list()
      .map((profile) => profile.label)
      .sort(),
  ).toEqual(['OpenAI Personal', 'OpenAI Work']);
});

it('keeps same-account workspace identities separate and never trusts a client ready flag', () => {
  const registry = profileRegistryFixture().open();
  const first = registry.create(codexSubscription);
  const second = registry.create(codexSubscription);

  registry.verify(first.id, 1, verifiedAccount('same-account', 'workspace-a'));
  registry.verify(second.id, 1, verifiedAccount('same-account', 'workspace-b'));

  expect(
    registry
      .list()
      .map((profile) => profile.identity?.workspaceRef)
      .sort(),
  ).toEqual(['workspace-a', 'workspace-b']);

  expect(() => registry.create({ ...codexSubscription, status: 'ready' } as never)).toThrow();
  expect(() => registry.update(first.id, 2, { status: 'ready' } as never)).toThrow();
});

it('uses revision checks and clears a disabled default without enabling it on auth refresh', () => {
  const registry = profileRegistryFixture().open();
  const created = registry.create(codexSubscription);
  const profile = registry.verify(created.id, 1, verifiedAccount());

  registry.setDefault(profile.id, profile.version);
  const disabled = registry.update(profile.id, profile.version, { enabled: false, label: 'Paused' });

  expect(() => registry.update(profile.id, profile.version, { label: 'Stale rename' })).toThrow(
    'LOCAL_REVISION_CONFLICT',
  );

  expect(registry.defaultFor('codex')).toBeNull();
  const refreshed = registry.verify(profile.id, disabled.version, verifiedAccount());

  expect(refreshed.status).toBe('disabled');
  expect(() => registry.setDefault(profile.id, refreshed.version)).toThrow('PROFILE_NOT_READY');
  const enabled = registry.update(profile.id, refreshed.version, { enabled: true });

  expect(enabled.status).toBe('ready');
  expect(registry.get(profile.id).label).toBe('Paused');
});

it('requires verified identity and isolation, rejecting provider or billing substitutions', () => {
  const registry = profileRegistryFixture().open();
  const profile = registry.create(codexSubscription);

  expect(() => registry.setDefault(profile.id, 1)).toThrow('PROFILE_NOT_READY');

  expect(() => registry.verify(profile.id, 1, { ...verifiedAccount(), authMode: 'api_key' })).toThrow(
    'PROFILE_MISMATCH',
  );

  expect(() => registry.verify(profile.id, 1, { ...verifiedAccount(), provider: 'claude' })).toThrow(
    'PROFILE_MISMATCH',
  );

  expect(() =>
    registry.verify(profile.id, 1, {
      ...verifiedAccount(),
      capabilities: { ...verifiedAccount().capabilities, isolation: 'unknown' },
    }),
  ).toThrow('PROFILE_NOT_READY');

  const ready = registry.verify(profile.id, 1, verifiedAccount());

  expect(() => registry.verify(profile.id, ready.version, verifiedAccount('changed-account'))).toThrow(
    'PROFILE_MISMATCH',
  );

  expect(registry.get(profile.id).identity?.accountRef).toBe('synthetic-account-a');
});

it('retains a removal tombstone until credential cleanup is acknowledged', () => {
  const { open } = profileRegistryFixture();
  const registry = open();
  const created = registry.create(codexSubscription);
  const ready = registry.verify(created.id, 1, verifiedAccount());

  registry.setDefault(ready.id, ready.version);
  const pending = registry.beginRemoval(ready.id, ready.version);

  expect(pending.status).toBe('removing');
  expect(registry.defaultFor('codex')).toBeNull();
  expect(open().list()).toMatchObject([{ id: ready.id, status: 'removing' }]);
  expect(() => registry.update(ready.id, pending.version, { enabled: true })).toThrow('PROFILE_NOT_READY');
  registry.completeRemoval(ready.id, pending.version);
  expect(open().list()).toEqual([]);
  expect(registry.get(ready.id).status).toBe('removed');

  expect(() => registry.verify(ready.id, pending.version + 1, verifiedAccount())).toThrow(
    'PROFILE_NOT_READY',
  );
});

it('bounds active profiles per owner without consuming another owner allowance', () => {
  const { open } = profileRegistryFixture();
  const registry = open();
  const first = registry.create(codexSubscription);

  for (let index = 1; index < 128; index++) {
    registry.create(codexSubscription);
  }

  expect(() => registry.create(codexSubscription)).toThrow('PROFILE_LIMIT_REACHED');
  expect(open('owner-b').create(codexSubscription).status).toBe('needs_authentication');
  const pending = registry.beginRemoval(first.id, 1);

  registry.completeRemoval(first.id, pending.version);
  expect(registry.create(codexSubscription).status).toBe('needs_authentication');
  expect(registry.list()).toHaveLength(128);
});
