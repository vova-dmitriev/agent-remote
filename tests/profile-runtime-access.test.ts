import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { expect, it } from 'vitest';
import { RuntimeProfiles } from '../apps/daemon/src/profiles/runtime/service.js';
import { encryptEnrollment } from '@transport/credentials/sealed-box.js';
import { profileServiceFixture } from './profiles/service.fixture.js';

function fixture() {
  const { options } = profileServiceFixture();
  const settings = join(options.directory, 'native-settings.json');

  writeFileSync(settings, '{}');

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: {
      executable: process.execPath,
      prefixArguments: [resolve('tests/profiles/native-peer.mjs'), settings],
      apiFetch: async () => Response.json({ data: [{ id: 'synthetic-model' }] }),
    },
  });

  return { runtime, options };
}

it('routes persistent profile CRUD through strict device-scoped access with no browser-chosen owner', async () => {
  const { runtime, options } = fixture();

  const created = await runtime.request({
    kind: 'mutate',
    mutation: {
      action: 'create_profile',
      operationId: randomUUID(),
      input: { label: 'Synthetic API', provider: 'codex', authMode: 'api_key' },
    },
  });

  expect(created.kind).toBe('mutate');
  const list = await runtime.request({ kind: 'list' });

  expect(list.kind === 'list' && list.data.profiles[0]).toMatchObject({
    ownerId: 'owner-a',
    deviceId: 'mac-a',
    label: 'Synthetic API',
  });

  const reopened = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  expect(await reopened.request({ kind: 'list' })).toMatchObject({
    ...list,
    data: { ...list.data, observedAt: expect.any(Number) },
  });

  await expect(runtime.request({ kind: 'list', ownerId: 'foreign' } as never)).rejects.toThrow();
  await runtime.close();
  await reopened.close();
});

it('does not read profile metadata or perform effects for a revoked caller', async () => {
  const { runtime } = fixture();

  await expect(runtime.request({ kind: 'list' }, () => false)).rejects.toThrow(/^UNAUTHORIZED$/);
  await expect(runtime.request({ kind: 'recipient' }, () => false)).rejects.toThrow(/^UNAUTHORIZED$/);
  await runtime.close();
});

it('enrolls encrypted credentials through the actual isolated native child and persists only safe operation metadata', async () => {
  const { runtime, options } = fixture();

  const create = await runtime.request({
    kind: 'mutate',
    mutation: {
      action: 'create_profile',
      operationId: randomUUID(),
      input: { label: 'Synthetic key', provider: 'codex', authMode: 'api_key' },
    },
  });

  if (create.kind !== 'mutate') {
    throw new Error('unexpected result');
  }

  const recipient = await runtime.request({ kind: 'recipient' });

  if (recipient.kind !== 'recipient') {
    throw new Error('unexpected result');
  }

  const begin = await runtime.request({
    kind: 'begin_enrollment',
    input: {
      operationId: randomUUID(),
      profileId: create.data.profileId,
      expectedVersion: 1,
      pinnedKeyId: recipient.data.recipientKeyId,
    },
  });

  if (begin.kind !== 'begin_enrollment') {
    throw new Error('unexpected result');
  }

  const input = await encryptEnrollment(
    begin.data,
    'synthetic-runtime-credential',
    recipient.data.recipientKeyId,
  );

  const complete = await runtime.request({ kind: 'complete_enrollment', input });

  expect(complete.kind === 'complete_enrollment' && complete.data.phase).toBe('complete');
  const list = await runtime.request({ kind: 'list' });

  expect(list.kind === 'list' && list.data.profiles[0]?.status).toBe('ready');

  if (list.kind !== 'list') {
    throw new Error('unexpected list');
  }

  const profile = list.data.profiles[0]!;

  const plan = await runtime.prepareExecution(
    { profileId: profile.id, provider: profile.provider, model: 'synthetic-model' },
    profile.version,
  );

  expect(plan.environment.CODEX_HOME).toContain(profile.id);
  expect(plan.profile.identity).toEqual(profile.identity);
  expect(JSON.stringify(list)).not.toContain('synthetic-runtime-credential');
  const rows = options.database.connection.prepare('SELECT value FROM profile_operations').all();

  expect(JSON.stringify(rows)).not.toContain('synthetic-runtime-credential');
  expect(JSON.stringify(rows)).not.toContain(input.ciphertext);

  const identity = JSON.parse(
    readFileSync(join(options.directory, 'credential-enrollment-key.json'), 'utf8'),
  );

  expect(JSON.stringify(list)).not.toContain(identity.privateKey);
  await runtime.close();
});
