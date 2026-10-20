import { expect, it } from 'vitest';
import { AgentProvider, ErrorCode, ReasoningEffort } from '@protocol';
import { prepareExecutionLaunch } from '../../../../apps/daemon/src/sessions/execution/plan.js';
import { profileServiceFixture } from '../../profiles/fixtures/service.fixture.js';
import { codexSubscription, verifiedAccount } from '../../profiles/fixtures/registry.fixture.js';

function fixture() {
  const { options, service } = profileServiceFixture();
  const first = service.registry.create(codexSubscription);
  const profile = service.registry.verify(first.id, first.version, verifiedAccount());

  const selection = {
    profileId: profile.id,
    provider: AgentProvider.Codex,
    model: 'synthetic-model',
    effort: ReasoningEffort.Medium,
  };

  const configuration = {
    registry: service.registry,
    directory: options.directory,
    baseEnvironment: {},
    verify: async () => verifiedAccount(),
  };

  return { profile, selection, configuration, registry: service.registry };
}

it('builds an isolated registry-backed plan without inherited credential or gateway overrides', async () => {
  const f = fixture();

  const plan = await prepareExecutionLaunch(f.selection, f.profile.version, {
    ...f.configuration,
    baseEnvironment: {
      PATH: '/synthetic/bin',
      OPENAI_API_KEY: 'synthetic-inherited-value',
      OPENAI_BASE_URL: 'https://example.invalid',
    },
  });

  expect(plan.profile.id).toBe(f.profile.id);
  expect(plan.environment.PATH).toBe('/synthetic/bin');
  expect(plan.environment.OPENAI_API_KEY).toBeUndefined();
  expect(plan.environment.OPENAI_BASE_URL).toBeUndefined();
  expect(plan.environment.CODEX_HOME).toContain(f.profile.id);
});

it.each([
  [{ provider: AgentProvider.Claude }, ErrorCode.PROFILE_MISMATCH],
  [{ model: 'unoffered-model' }, ErrorCode.PROFILE_MODEL_UNAVAILABLE],
  [{ effort: ReasoningEffort.Ultra }, ErrorCode.PROFILE_EFFORT_UNAVAILABLE],
])('rejects an incompatible selection before starting a native verifier: %j', async (change, code) => {
  const f = fixture();
  let probes = 0;

  await expect(
    prepareExecutionLaunch({ ...f.selection, ...change }, f.profile.version, {
      ...f.configuration,
      verify: async () => {
        probes++;

        return verifiedAccount();
      },
    }),
  ).rejects.toThrow(code);

  expect(probes).toBe(0);
});

it('rejects a stale profile, a different native identity and caller revocation without returning a launch plan', async () => {
  const f = fixture();

  await expect(prepareExecutionLaunch(f.selection, 1, f.configuration)).rejects.toThrow(
    ErrorCode.LOCAL_REVISION_CONFLICT,
  );

  await expect(
    prepareExecutionLaunch(f.selection, f.profile.version, {
      ...f.configuration,
      verify: async () => verifiedAccount('another-account'),
    }),
  ).rejects.toThrow(ErrorCode.PROFILE_MISMATCH);

  let current = true;

  await expect(
    prepareExecutionLaunch(
      f.selection,
      f.profile.version,
      {
        ...f.configuration,
        verify: async () => {
          current = false;

          return verifiedAccount();
        },
      },
      () => current,
    ),
  ).rejects.toThrow(ErrorCode.UNAUTHORIZED);
});

it('rejects profile edits while native identity discovery is awaiting a result', async () => {
  const f = fixture();

  await expect(
    prepareExecutionLaunch(f.selection, f.profile.version, {
      ...f.configuration,
      verify: async () => {
        f.registry.update(f.profile.id, f.profile.version, { label: 'Changed while verifying' });

        return verifiedAccount();
      },
    }),
  ).rejects.toThrow(ErrorCode.LOCAL_REVISION_CONFLICT);
});

it('rechecks the selected model against current native offers instead of silently selecting another model', async () => {
  const f = fixture();

  await expect(
    prepareExecutionLaunch(f.selection, f.profile.version, {
      ...f.configuration,
      verify: async () => ({ ...verifiedAccount(), models: [] }),
    }),
  ).rejects.toThrow(ErrorCode.PROFILE_MODEL_UNAVAILABLE);
});

it('keeps two verified accounts in separate homes and copies the selection before awaits', async () => {
  const f = fixture();
  const created = f.registry.create({ ...codexSubscription, label: 'Work' });
  const second = f.registry.verify(created.id, created.version, verifiedAccount('account-b'));

  const firstPlan = await prepareExecutionLaunch(f.selection, f.profile.version, {
    ...f.configuration,
    verify: async () => {
      f.selection.profileId = second.id;

      return verifiedAccount();
    },
  });

  const secondPlan = await prepareExecutionLaunch(f.selection, second.version, {
    ...f.configuration,
    verify: async () => verifiedAccount('account-b'),
  });

  expect(firstPlan.profile.id).toBe(f.profile.id);
  expect(firstPlan.environment.CODEX_HOME).not.toBe(secondPlan.environment.CODEX_HOME);
  f.registry.update(f.profile.id, f.profile.version, { enabled: false });
  expect(firstPlan.assertCurrent).toThrow(ErrorCode.LOCAL_REVISION_CONFLICT);
});
