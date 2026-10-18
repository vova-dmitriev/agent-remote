import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { CodexProfileNative } from '../apps/daemon/src/profiles/native/codex.js';
import { buildProfileEnvironment } from '../apps/daemon/src/profiles/environment.js';
import { codexSubscription, profileRegistryFixture } from './profiles/registry.fixture.js';

async function fixture(
  settings: Record<string, unknown> = {},
  api = false,
  apiFetch: typeof fetch = async () => Response.json({ data: [{ id: 'synthetic-model' }] }),
) {
  const { directory, open } = profileRegistryFixture();
  const registry = open();
  const profile = registry.create({ ...codexSubscription, authMode: api ? 'api_key' : 'subscription' });

  const environment = await buildProfileEnvironment(registry, profile.id, {
    directory,
    base: {},
    purpose: 'enrollment',
  });

  const config = join(directory, 'native-settings.json');

  writeFileSync(config, JSON.stringify({ email: 'personal@synthetic.invalid', ...settings }));

  writeFileSync(
    join(environment.CODEX_HOME!, 'auth.json'),
    JSON.stringify({ tokens: { account_id: 'synthetic-workspace' } }),
    { mode: 0o600 },
  );

  const native = await CodexProfileNative.open(environment, profile, {
    executable: process.execPath,
    apiFetch,
    prefixArguments: [resolve('tests/profiles/native-peer.mjs'), config],
  });

  return { registry, profile, native, environment };
}

it('observes native account and model metadata without serializing native credential files', async () => {
  const { profile, native, registry } = await fixture();

  try {
    const evidence = await native.probe();
    const ready = registry.verify(profile.id, 1, evidence);

    expect(ready).toMatchObject({
      status: 'ready',
      authMode: 'subscription',
      identity: { workspaceRef: 'synthetic-workspace' },
      models: [{ id: 'synthetic-model', efforts: ['medium'] }],
    });

    expect(ready.identity?.accountRef).not.toContain('personal@');
    expect(JSON.stringify(ready)).not.toContain('tokens');
    expect(ready.capabilities.quota).toBe(false);
  } finally {
    await native.close();
  }
});

it('enrolls an API key only through framed stdin and returns safe identity metadata', async () => {
  const { native, registry, profile, environment } = await fixture({}, true);

  try {
    await native.loginApiKey('synthetic-disposable-api-credential');
    const ready = registry.verify(profile.id, 1, await native.probe());

    expect(ready.status).toBe('ready');
    expect(ready.authMode).toBe('api_key');
    expect(ready.identity?.accountRef).toMatch(/^codex-key:/);
    expect(JSON.stringify(ready)).not.toContain('synthetic-disposable-api-credential');
    expect(JSON.stringify(environment)).not.toContain('synthetic-disposable-api-credential');
  } finally {
    await native.close();
  }
});

it('refuses native billing-mode and identity changes before readiness', async () => {
  const { native, registry, profile } = await fixture({ changeIdentity: true });

  try {
    await expect(native.loginApiKey('synthetic-unexpected-secret')).rejects.toThrow('PROFILE_MISMATCH');
    await expect(native.probe()).rejects.toThrow('PROFILE_MISMATCH');
    expect(registry.get(profile.id).status).toBe('needs_authentication');
  } finally {
    await native.close();
  }
});

it('bounds a cyclic native model catalog instead of looping indefinitely', async () => {
  const { native } = await fixture({ cycle: true });

  try {
    await expect(native.probe()).rejects.toThrow('CODEX_PROTOCOL_ERROR');
  } finally {
    await native.close();
  }
});

it('returns only the transient public login fields accepted by the shared authentication contract', async () => {
  const { native } = await fixture();

  try {
    expect(await native.loginSubscription()).toEqual({
      loginId: 'synthetic-login',
      authUrl: 'https://auth.openai.com/authorize?state=synthetic-only',
    });
  } finally {
    await native.close();
  }
});

it.each([
  'http://auth.openai.com/authorize',
  'https://synthetic.invalid/steal',
  'https://auth.openai.com@synthetic.invalid/',
])('rejects untrusted subscription login URL %s', async (authUrl) => {
  const { native } = await fixture({ authUrl });

  try {
    await expect(native.loginSubscription()).rejects.toThrow('CODEX_PROTOCOL_ERROR');
  } finally {
    await native.close();
  }
});

it('does not report API readiness from a native cached login when the provider rejects its key', async () => {
  const apiFetch = vi.fn(async () => new Response('synthetic-secret-provider-body', { status: 401 }));
  const { native, registry, profile } = await fixture({}, true, apiFetch);

  try {
    await native.loginApiKey('synthetic-rejected-credential');
    await expect(native.probe()).rejects.toThrow(/^PROFILE_NOT_READY$/);
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(registry.get(profile.id).status).toBe('needs_authentication');
  } finally {
    await native.close();
  }
});
