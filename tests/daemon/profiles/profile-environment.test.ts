import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildProfileEnvironment } from '@daemon/profiles/environment.js';
import { codexSubscription, profileRegistryFixture, verifiedAccount } from './fixtures/registry.fixture.js';

it('removes inherited credentials and isolates native homes without modifying the parent environment', async () => {
  const { open, directory } = profileRegistryFixture();
  const registry = open();
  const first = registry.create(codexSubscription);
  const second = registry.create({ ...codexSubscription, label: 'OpenAI Work' });

  registry.verify(first.id, 1, verifiedAccount());
  registry.verify(second.id, 1, verifiedAccount('synthetic-account-b'));

  const base = {
    HOME: '/synthetic/global-home',
    PATH: '/synthetic/bin',
    TERM: 'xterm-256color',
    CMUX_WORKSPACE_ID: 'workspace-a',
    CMUX_SURFACE_ID: 'surface-a',
    CMUX_SOCKET_PATH: '/synthetic/cmux.sock',
    OPENAI_API_KEY: 'synthetic-parent-secret',
    CODEX_API_KEY: 'synthetic-parent-secret',
    ANTHROPIC_API_KEY: 'synthetic-parent-secret',
    ANTHROPIC_AUTH_TOKEN: 'synthetic-parent-secret',
    CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-parent-secret',
    OPENAI_BASE_URL: 'https://synthetic.invalid',
    AWS_ACCESS_KEY_ID: 'synthetic-parent-secret',
    CUSTOM_PROVIDER_KEY: 'synthetic-parent-secret',
    CODEX_HOME: '/synthetic/global-codex',
    CLAUDE_CONFIG_DIR: '/synthetic/global-claude',
  };

  const a = await buildProfileEnvironment(registry, first.id, { directory, base });
  const b = await buildProfileEnvironment(registry, second.id, { directory, base });

  expect(JSON.stringify(a)).not.toContain('synthetic-parent-secret');
  expect(JSON.stringify(a)).not.toContain('https://synthetic.invalid');

  expect(a).toMatchObject({
    PATH: '/synthetic/bin',
    TERM: 'xterm-256color',
    CMUX_WORKSPACE_ID: 'workspace-a',
    CMUX_SURFACE_ID: 'surface-a',
    CMUX_SOCKET_PATH: '/synthetic/cmux.sock',
  });

  expect(a.CODEX_HOME).not.toBe(b.CODEX_HOME);
  expect(a.HOME).not.toBe(b.HOME);
  expect(a.CLAUDE_CONFIG_DIR).not.toBe(b.CLAUDE_CONFIG_DIR);
  expect(a.CODEX_SQLITE_HOME).toBe(a.CODEX_HOME);
  expect(a.HOME).not.toBe(base.HOME);
  expect(base.OPENAI_API_KEY).toBe('synthetic-parent-secret');

  expect(readFileSync(join(a.CODEX_HOME!, 'config.toml'), 'utf8')).toContain(
    'cli_auth_credentials_store = "file"',
  );

  expect(lstatSync(a.CODEX_HOME!).mode & 0o077).toBe(0);
  expect(lstatSync(join(a.CODEX_HOME!, 'config.toml')).mode & 0o077).toBe(0);

  expect((await buildProfileEnvironment(registry, first.id, { directory, base })).CODEX_HOME).toBe(
    a.CODEX_HOME,
  );
});

it('blocks execution before authentication and permits isolated enrollment without accepting disabled profiles', async () => {
  const { open, directory } = profileRegistryFixture();
  const registry = open();
  const profile = registry.create(codexSubscription);

  await expect(buildProfileEnvironment(registry, profile.id, { directory, base: {} })).rejects.toThrow(
    'PROFILE_NOT_READY',
  );

  const env = await buildProfileEnvironment(registry, profile.id, {
    directory,
    base: {},
    purpose: 'enrollment',
  });

  expect(env.CODEX_HOME).toBeTruthy();
  registry.update(profile.id, 1, { enabled: false });

  await expect(
    buildProfileEnvironment(registry, profile.id, { directory, base: {}, purpose: 'enrollment' }),
  ).rejects.toThrow('PROFILE_NOT_READY');
});

it('rejects symlinked native roots rather than writing into a global login', async () => {
  const { open, directory } = profileRegistryFixture();
  const registry = open();
  const profile = registry.create(codexSubscription);

  const env = await buildProfileEnvironment(registry, profile.id, {
    directory,
    base: {},
    purpose: 'enrollment',
  });

  rmSync(env.CODEX_HOME!, { recursive: true });
  const global = join(directory, 'unrelated-global');

  mkdirSync(global);
  symlinkSync(global, env.CODEX_HOME!);

  await expect(
    buildProfileEnvironment(registry, profile.id, { directory, base: {}, purpose: 'enrollment' }),
  ).rejects.toThrow('UNAUTHORIZED');

  expect(readdirSync(global)).toEqual([]);
});

it('rejects an inherited readable credential file and fails closed after profile removal', async () => {
  const { open, directory } = profileRegistryFixture();
  const registry = open();
  const profile = registry.create(codexSubscription);

  const env = await buildProfileEnvironment(registry, profile.id, {
    directory,
    base: {},
    purpose: 'enrollment',
  });

  const credential = join(env.CODEX_HOME!, 'auth.json');

  writeFileSync(credential, '{}', { mode: 0o644 });

  await expect(
    buildProfileEnvironment(registry, profile.id, { directory, base: {}, purpose: 'enrollment' }),
  ).rejects.toThrow('UNAUTHORIZED');

  chmodSync(credential, 0o600);
  registry.beginRemoval(profile.id, 1);

  await expect(
    buildProfileEnvironment(registry, profile.id, { directory, base: {}, purpose: 'enrollment' }),
  ).rejects.toThrow('PROFILE_NOT_READY');
});
