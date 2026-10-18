import {
  AgentProvider,
  ProfileAuthMode,
  ProfileStatus,
  CapabilitySupport,
  type ExecutionProfileSummary,
} from '../packages/protocol/src/index.js';
import { describe, expect, it } from 'vitest';
import { resolveSessionProfileStatus } from '../apps/mini-app/src/features/create-session/model/profile-status.js';
import {
  sessionControlsEN,
  sessionControlsRU,
} from '../apps/mini-app/src/shared/lib/i18n/dictionaries/session-controls.js';

const profile = (authMode: ProfileAuthMode): ExecutionProfileSummary => ({
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: 'owner',
  deviceId: 'device',
  provider: AgentProvider.Codex,
  authMode,
  label: 'Synthetic account B',
  status: ProfileStatus.Ready,
  identity: { accountRef: 'account', verifiedAt: Date.now() },
  capabilities: {
    isolation: CapabilitySupport.Supported,
    createSession: true,
    contextSeed: true,
    resume: true,
    quota: true,
  },
  models: [],
  version: 1,
  updatedAt: Date.now(),
});

function createTranslate(dictionary: Record<string, string>) {
  return (key: string, parameters?: Record<string, string | number>) =>
    (dictionary[key] ?? key).replace(/\{\{(\w+)\}\}/gu, (_, name: string) =>
      String(parameters?.[name] ?? ''),
    );
}

const translateEN = createTranslate(sessionControlsEN);
const translateRU = createTranslate(sessionControlsRU);

describe('session profile launch status', () => {
  it('identifies the selected profile and subscription billing', () => {
    const status = resolveSessionProfileStatus(
      {
        profileId: 'profile-b',
        profile: profile(ProfileAuthMode.Subscription),
        profileAvailable: true,
        modelId: 'synthetic-model',
      },
      { online: true, unavailable: false, checking: false },
      translateEN,
    );

    expect(status).toContain('Synthetic account B');
    expect(status).toContain('subscription');
  });

  it('identifies API-key billing for the selected profile', () => {
    const status = resolveSessionProfileStatus(
      {
        profileId: 'profile-b',
        profile: profile(ProfileAuthMode.ApiKey),
        profileAvailable: true,
        modelId: 'synthetic-model',
      },
      { online: true, unavailable: false, checking: false },
      translateEN,
    );

    expect(status).toContain('API key');
  });

  it('keeps explicit selection unavailable during refresh instead of falling back to legacy copy', () => {
    const status = resolveSessionProfileStatus(
      {
        profileId: 'profile-b',
        profile: profile(ProfileAuthMode.Subscription),
        profileAvailable: false,
        modelId: '',
      },
      { online: true, unavailable: false, checking: true },
      translateEN,
    );

    expect(status).toContain('Synthetic account B');
    expect(status).toContain('currently unavailable');
  });

  it('shows legacy account copy only when no profile is selected', () => {
    const status = resolveSessionProfileStatus(
      { profileId: '', profile: undefined, profileAvailable: false, modelId: '' },
      { online: true, unavailable: false, checking: false },
      translateEN,
    );

    expect(status).toContain('Default native launch');
  });

  it('localizes profile billing and explains model selection in Russian', () => {
    const status = resolveSessionProfileStatus(
      {
        profileId: 'profile-b',
        profile: profile(ProfileAuthMode.Subscription),
        profileAvailable: true,
        modelId: '',
      },
      { online: true, unavailable: false, checking: false },
      translateRU,
    );

    expect(status).toContain('Synthetic account B');
    expect(status).toContain('подписку');
    expect(status).toContain('Выбери модель ниже');
  });
});
