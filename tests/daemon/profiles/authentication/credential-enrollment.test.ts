import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { CredentialEnrollmentService } from '../../../../apps/daemon/src/profiles/enrollment/service.js';
import { encryptEnrollment } from '@transport/credentials/sealed-box.js';
import { enrollmentFixture } from '../fixtures/enrollment.fixture.js';

it('issues an exact five-minute challenge and retains the recipient identity across restart', async () => {
  const f = await enrollmentFixture();
  const challenge = await f.enrollment.begin(f.request);

  expect(challenge.expiresAt - challenge.issuedAt).toBe(300000);
  expect(challenge.ownerId).toBe('owner-a');
  expect(challenge.profileVersion).toBe(1);

  expect(await new CredentialEnrollmentService(f.configuration).recipient()).toEqual(
    await f.enrollment.recipient(),
  );

  expect(await f.enrollment.begin(f.request)).toEqual(challenge);
  expect(f.enrollment.operation(f.request.operationId).phase).toBe('awaiting_authentication');

  expect(Object.keys(await f.enrollment.recipient()).sort()).toEqual([
    'algorithm',
    'deviceId',
    'ownerId',
    'recipientKeyId',
    'recipientPublicKey',
    'version',
  ]);
});

it('stores only safe operation metadata and applies a consumed challenge exactly once', async () => {
  const f = await enrollmentFixture();
  const envelope = await f.seal();
  const complete = await f.enrollment.complete(envelope);

  expect(complete.phase).toBe('complete');

  expect(f.service.registry.get(f.profile.id)).toMatchObject({
    status: 'ready',
    authMode: 'api_key',
    version: 3,
  });

  expect(readFileSync(f.credential, 'utf8')).toBe('synthetic-private-enrollment-key');
  expect(await f.enrollment.complete(envelope)).toEqual(complete);
  expect(readFileSync(f.calls, 'utf8')).toBe('native login\n');

  for (const table of f.options.database.connection
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]) {
    const rows = f.options.database.connection
      .prepare('SELECT * FROM "' + table.name.replaceAll('"', '""') + '"')
      .all();

    expect(JSON.stringify(rows)).not.toContain('synthetic-private-enrollment-key');
    expect(JSON.stringify(rows)).not.toContain(envelope.ciphertext);
  }
});

it('rejects different ciphertext on an already consumed operation rather than replacing the credential', async () => {
  const f = await enrollmentFixture();
  const original = await f.seal();
  const replacement = await f.seal('synthetic-different-key');

  await f.enrollment.complete(original);
  await expect(f.enrollment.complete(replacement)).rejects.toThrow('ENROLLMENT_REPLAYED');
  expect(readFileSync(f.credential, 'utf8')).toBe('synthetic-private-enrollment-key');
  expect(readFileSync(f.calls, 'utf8')).toBe('native login\n');
});

it('rejects unpinned, expired and retagged requests before writing a native key', async () => {
  const f = await enrollmentFixture();

  await expect(f.enrollment.begin({ ...f.request, pinnedKeyId: '0'.repeat(64) })).rejects.toThrow(
    'ENROLLMENT_KEY_UNTRUSTED',
  );

  const challenge = await f.enrollment.begin(f.request);

  const foreign = await encryptEnrollment(
    { ...challenge, deviceId: 'other-mac' },
    'synthetic-private-enrollment-key',
    challenge.recipientKeyId,
    1000,
  );

  await expect(f.enrollment.complete(foreign)).rejects.toThrow('ENROLLMENT_INVALID');
  const expired = await f.seal();

  f.setTime(301000);
  await expect(f.enrollment.complete(expired)).rejects.toThrow('ENROLLMENT_EXPIRED');
  expect(existsSync(f.credential)).toBe(false);
});

it('fences another owner and a stale/disabled destination before credential enrollment', async () => {
  const f = await enrollmentFixture();

  const foreign = new CredentialEnrollmentService({
    ...f.configuration,
    scope: { ownerId: 'foreign-owner', deviceId: 'mac-a' },
  });

  await expect(foreign.begin(f.request)).rejects.toThrow('NOT_FOUND');
  const envelope = await f.seal();

  f.service.registry.update(f.profile.id, 1, { enabled: false });
  await expect(f.enrollment.complete(envelope)).rejects.toThrow('LOCAL_REVISION_CONFLICT');

  await expect(
    f.enrollment.begin({ ...f.request, operationId: randomUUID(), expectedVersion: 2 }),
  ).rejects.toThrow('PROFILE_NOT_READY');

  expect(existsSync(f.credential)).toBe(false);
});
