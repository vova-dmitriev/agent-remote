import {
  AgentProvider,
  CapabilitySupport,
  ProfileAuthMode,
  ProfileStatus,
  ReasoningEffort,
  type ExecutionProfileSummary,
} from '@protocol';
import { describe, expect, it } from 'vitest';
import {
  effortOptions,
  modelOptions,
  profileOptions,
} from '@/features/create-session/model/launch-options.js';
import { SESSION_CREATE_IDS } from '@/features/create-session/config/test-ids.js';
import { sessionControlsEN } from '@/shared/lib/i18n/dictionaries/session-controls.js';

const profile: ExecutionProfileSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: 'owner',
  deviceId: 'device',
  provider: AgentProvider.Codex,
  authMode: ProfileAuthMode.ApiKey,
  label: 'Synthetic account',
  status: ProfileStatus.Ready,
  identity: { accountRef: 'account', accountLabel: 'Synthetic workspace', verifiedAt: 1 },
  capabilities: {
    isolation: CapabilitySupport.Supported,
    createSession: true,
    contextSeed: false,
    resume: false,
    quota: false,
  },
  models: [{ id: 'synthetic-model', efforts: [ReasoningEffort.Low, ReasoningEffort.High] }],
  version: 1,
  updatedAt: 1,
};

const translate = (key: string, parameters?: Record<string, string | number>) =>
  ((sessionControlsEN as Record<string, string>)[key] ?? key).replace(/\{\{(\w+)\}\}/gu, (_, name: string) =>
    String(parameters?.[name] ?? ''),
  );

describe('create-session launch options', () => {
  it('lists the native launch first, then each profile as label · account · auth mode', () => {
    const options = profileOptions([profile], '', undefined, 'Native', translate);

    expect(options.map((option) => option.value)).toEqual(['', profile.id]);
    expect(options[1]!.label).toBe('Synthetic account · Synthetic workspace · accountsApiKey');

    expect(
      options.every((option) => option.testId === SESSION_CREATE_IDS.profileOption && !option.disabled),
    ).toBe(true);
  });

  it('keeps a selected profile that is no longer offered as a disabled entry', () => {
    const options = profileOptions([], profile.id, profile, 'Native', translate);

    expect(options.at(-1)).toMatchObject({ value: profile.id, disabled: true });
    expect(options.at(-1)!.label).toContain('Synthetic account');
  });

  it('offers the profile models after a disabled entry for an unavailable selected model', () => {
    const options = modelOptions(profile, 'retired-model', translate);

    expect(options.map((option) => [option.value, !!option.disabled])).toEqual([
      ['', false],
      ['retired-model', true],
      ['synthetic-model', false],
    ]);
  });

  it('offers the selected model efforts and disables an effort it no longer supports', () => {
    const model = profile.models[0]!;

    expect(effortOptions(model, ReasoningEffort.High, translate).map((option) => option.value)).toEqual([
      '',
      ReasoningEffort.Low,
      ReasoningEffort.High,
    ]);

    expect(effortOptions(model, ReasoningEffort.Medium, translate)[1]).toMatchObject({
      value: ReasoningEffort.Medium,
      disabled: true,
    });
  });
});
