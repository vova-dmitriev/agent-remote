import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { AgentProvider, ProfileAuthMode } from '@protocol';
import { buildClaudeProfileLaunch } from '../apps/daemon/src/profiles/claude/launch.js';
import { readClaudeApiKey } from '../apps/daemon/src/profiles/claude/api-key-helper.js';
import { verifyClaudeApiKey } from '../apps/daemon/src/profiles/claude/api.js';
import {
  subscriptionSignInBlocker,
  verifyClaudeAuthentication,
} from '../apps/daemon/src/profiles/claude/verification.js';

const paths = () => {
  const directory = mkdtempSync(join(tmpdir(), 'claude-profile-'));
  const configDirectory = join(directory, 'config');
  const credentialFile = join(configDirectory, 'credentials', 'anthropic-api-key');

  return { directory, configDirectory, credentialFile };
};

it('builds a bare Claude API-key launch with a private file helper and no inherited auth', () => {
  const profile = paths();

  const plan = buildClaudeProfileLaunch(
    {
      provider: AgentProvider.Claude,
      authMode: ProfileAuthMode.ApiKey,
      configDirectory: profile.configDirectory,
      credentialFile: profile.credentialFile,
      helperPath: resolve('apps/daemon/src/profiles/claude/api-key-helper.js'),
      nodeExecutable: process.execPath,
    },
    {
      PATH: '/synthetic/bin',
      TERM: 'xterm-256color',
      ANTHROPIC_API_KEY: 'inherited-api-key',
      ANTHROPIC_AUTH_TOKEN: 'inherited-auth-token',
      CLAUDE_CODE_OAUTH_TOKEN: 'inherited-oauth-token',
      ANTHROPIC_PROFILE: 'global-profile',
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_ACCESS_KEY_ID: 'inherited-cloud-key',
    },
  );

  const settings = JSON.parse(plan.args[plan.args.indexOf('--settings') + 1]!);

  expect(plan.args).toContain('--bare');
  expect(plan.args).toContain('--setting-sources');

  expect(plan.environment).toMatchObject({
    PATH: '/synthetic/bin',
    TERM: 'xterm-256color',
    CLAUDE_CONFIG_DIR: profile.configDirectory,
    CLAUDE_PROFILE_API_KEY_FILE: profile.credentialFile,
  });

  expect(settings.apiKeyHelper).toContain('api-key-helper.js');
  expect(plan.args.join(' ')).not.toContain('inherited-api-key');
  expect(plan.args.join(' ')).not.toContain('anthropic-api-key');
  expect(plan.environment).not.toHaveProperty('ANTHROPIC_API_KEY');
  expect(plan.environment).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
  expect(plan.environment).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  expect(plan.environment).not.toHaveProperty('ANTHROPIC_PROFILE');
  expect(plan.environment).not.toHaveProperty('CLAUDE_CODE_USE_BEDROCK');
  expect(plan.environment).not.toHaveProperty('AWS_ACCESS_KEY_ID');
});

it('uses a profile-specific configuration root for subscription launches without claiming readiness', () => {
  const profile = paths();

  const plan = buildClaudeProfileLaunch({
    provider: AgentProvider.Claude,
    authMode: ProfileAuthMode.Subscription,
    configDirectory: profile.configDirectory,
  });

  expect(plan.environment.CLAUDE_CONFIG_DIR).toBe(profile.configDirectory);
  expect(plan.args).not.toContain('--bare');
  expect(plan.args).toContain('--setting-sources');
});

it('reads only an owner-private, non-symlink profile credential file', async () => {
  const profile = paths();

  mkdirSync(join(profile.configDirectory, 'credentials'), { recursive: true, mode: 0o700 });
  writeFileSync(profile.credentialFile, 'synthetic-api-key', { mode: 0o600 });

  await expect(readClaudeApiKey(profile.credentialFile)).resolves.toBe('synthetic-api-key');

  chmodSync(profile.credentialFile, 0o644);
  await expect(readClaudeApiKey(profile.credentialFile)).rejects.toThrow('UNAUTHORIZED');

  const link = join(profile.configDirectory, 'credentials', 'credential-link');

  symlinkSync(profile.credentialFile, link);
  await expect(readClaudeApiKey(link)).rejects.toThrow('PROFILE_NOT_READY');
});

it('validates a profile API key with one protected models request and never follows redirects', async () => {
  const profile = paths();

  mkdirSync(join(profile.configDirectory, 'credentials'), { recursive: true, mode: 0o700 });
  writeFileSync(profile.credentialFile, 'synthetic-claude-api-key', { mode: 0o600 });
  let request: Request | undefined;

  const result = await verifyClaudeApiKey(
    profile.configDirectory,
    profile.credentialFile,
    async (input, init) => {
      request = new Request(input, init);

      return Response.json({ data: [{ id: 'synthetic-model' }], has_more: false });
    },
  );

  expect(request?.url).toBe('https://api.anthropic.com/v1/models?limit=100');
  expect(request?.method).toBe('GET');
  expect(request?.redirect).toBe('error');
  expect(request?.headers.get('x-api-key')).toBe('synthetic-claude-api-key');
  expect(request?.headers.get('anthropic-version')).toBe('2023-06-01');
  expect(result.models).toEqual(['synthetic-model']);
  expect(JSON.stringify(result)).not.toContain('synthetic-claude-api-key');
});

it('rejects a key file outside its profile before making a provider request', async () => {
  const profile = paths();
  let requested = false;

  await expect(
    verifyClaudeApiKey(profile.configDirectory, join(profile.directory, 'global-key'), async () => {
      requested = true;

      return Response.json({ data: [] });
    }),
  ).rejects.toThrow('UNAUTHORIZED');

  expect(requested).toBe(false);
});

it('accepts native identity evidence only for the selected profile and auth mode', () => {
  const profile = paths();

  const evidence = {
    authenticated: true,
    authMode: ProfileAuthMode.ApiKey,
    configDirectory: profile.configDirectory,
    accountRef: 'claude-key:synthetic-reference',
  };

  expect(
    verifyClaudeAuthentication(
      { provider: AgentProvider.Claude, authMode: ProfileAuthMode.ApiKey },
      profile.configDirectory,
      evidence,
    ),
  ).toEqual({ authMode: ProfileAuthMode.ApiKey, accountRef: evidence.accountRef });

  expect(() =>
    verifyClaudeAuthentication(
      { provider: AgentProvider.Claude, authMode: ProfileAuthMode.ApiKey },
      profile.configDirectory,
      { ...evidence, configDirectory: join(profile.directory, 'other-profile') },
    ),
  ).toThrow('PROFILE_MISMATCH');
});

it('keeps subscription sign-in blocked and verifies subscription only from native identity evidence', () => {
  const profile = paths();

  expect(subscriptionSignInBlocker()).toBe('CLAUDE_SUBSCRIPTION_SIGN_IN_NOT_WIRED');

  expect(
    verifyClaudeAuthentication(
      { provider: AgentProvider.Claude, authMode: ProfileAuthMode.Subscription },
      profile.configDirectory,
      {
        authenticated: true,
        authMode: ProfileAuthMode.Subscription,
        configDirectory: profile.configDirectory,
        accountRef: 'claude-subscription:synthetic-native-account',
      },
    ),
  ).toEqual({
    authMode: ProfileAuthMode.Subscription,
    accountRef: 'claude-subscription:synthetic-native-account',
  });

  expect(() =>
    verifyClaudeAuthentication(
      { provider: AgentProvider.Claude, authMode: ProfileAuthMode.Subscription },
      profile.configDirectory,
      {
        authenticated: false,
        authMode: ProfileAuthMode.Subscription,
        configDirectory: profile.configDirectory,
        accountRef: '',
      },
    ),
  ).toThrow('PROFILE_NOT_READY');
});
