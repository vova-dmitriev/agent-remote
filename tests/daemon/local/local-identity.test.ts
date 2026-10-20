import { existsSync } from 'node:fs';
import { privateFile } from '../../../apps/daemon/src/local/bootstrap/private-file.js';
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalIdentity, localClientSecret } from '../../../apps/daemon/src/local/bootstrap/identity.js';

const directories: string[] = [];

afterEach(async () => {
  for (const dir of directories.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

it('persists installation authority without a relay and refuses silently relabeling an existing device', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-identity-test-'));

  directories.push(dir);
  const first = await loadLocalIdentity(dir);

  expect(await loadLocalIdentity(dir)).toEqual(first);
  expect(await localClientSecret(dir)).toBe(await localClientSecret(dir));
  await expect(loadLocalIdentity(dir, 'another-device')).rejects.toThrow('LOCAL_COMPANION_MISMATCH');
});

it('refuses symlinked identity files instead of reading another installation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-identity-test-'));
  const other = await mkdtemp(join(tmpdir(), 'agent-identity-test-'));

  directories.push(dir, other);
  await loadLocalIdentity(other);
  await symlink(join(other, 'local-identity.json'), join(dir, 'local-identity.json'));
  await expect(loadLocalIdentity(dir)).rejects.toThrow('UNAUTHORIZED');
});

it('publishes one complete identity during concurrent first launch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-identity-race-'));

  directories.push(dir);
  const identities = await Promise.all(Array.from({ length: 32 }, () => loadLocalIdentity(dir)));
  const secrets = await Promise.all(Array.from({ length: 32 }, () => localClientSecret(dir)));

  expect(new Set(identities.map((value) => JSON.stringify(value))).size).toBe(1);
  expect(new Set(secrets).size).toBe(1);
});

it('never exposes an incomplete credential at its published path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-identity-publish-'));

  directories.push(dir);
  const path = join(dir, 'authority');

  const value = await privateFile(path, () => {
    expect(existsSync(path)).toBe(false);

    return 'complete synthetic credential';
  });

  expect(value).toBe('complete synthetic credential');
});
