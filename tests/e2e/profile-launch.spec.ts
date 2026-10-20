import { expect } from '@playwright/test';
import {
  AgentProvider,
  CommandActionType,
  FrameType,
  ProfileAction,
  ProfileRequestKind,
  ReasoningEffort,
  serverFrameSchema,
} from '@protocol';
import { SESSION_CREATE_IDS } from '@/features/create-session/config/test-ids.js';
import { identity } from './support/identity.js';
import { delivered, deviceFixture, setCommandOutcome, test } from './support/relay-fixture.js';
import { publishSnapshot } from './product/device.js';
import { profileCompanion } from './accounts/companion.js';
import { readyLaunchProfile } from './profile-launch/fixture.js';
import { FixtureCommandOutcome } from './runtime/command-outcome-values.js';

test('sends the explicitly selected account, model and effort once without falling back to another profile', async ({ page }) => {
  const companion = await profileCompanion();

  try {
    const first = await readyLaunchProfile(companion.runtime, 'Synthetic account A');
    const second = await readyLaunchProfile(companion.runtime, 'Synthetic account B');

    await companion.runtime.request({
      kind: ProfileRequestKind.Mutate,
      mutation: { action: ProfileAction.SetDefault, operationId: crypto.randomUUID(), profileId: first.id, expectedVersion: first.version },
    });

    await publishSnapshot((snapshot) => {
      snapshot.sessions[0]!.cwd = '/synthetic/project';
      snapshot.sessions[0]!.capabilities.createSession = true;
    });

    setCommandOutcome(FixtureCommandOutcome.Held);
    await identity(page, '801', 'en');
    await page.goto('/');
    await page.getByTestId(SESSION_CREATE_IDS.toggle).click();
    await expect(page.getByTestId(SESSION_CREATE_IDS.profile)).toHaveValue('');
    await page.getByTestId(SESSION_CREATE_IDS.profile).selectOption(second.id);
    await expect(page.getByTestId(SESSION_CREATE_IDS.profileStatus)).toContainText('Synthetic account B');
    await expect(page.getByTestId(SESSION_CREATE_IDS.submit)).toBeDisabled();
    await page.getByTestId(SESSION_CREATE_IDS.model).selectOption('synthetic-model');
    await page.getByTestId(SESSION_CREATE_IDS.effort).selectOption(ReasoningEffort.Medium);
    deviceFixture().sockets[0]!.close();
    await expect(page.getByTestId(SESSION_CREATE_IDS.submit)).toBeDisabled();
    await companion.reconnect();

    deviceFixture().sockets[0]!.on('message', (raw) => {
      const frame = serverFrameSchema.safeParse(JSON.parse(String(raw)));

      if (frame.success && frame.data.type === FrameType.Command) delivered.push(frame.data.command);
    });

    await publishSnapshot((snapshot) => {
      snapshot.sessions[0]!.cwd = '/synthetic/project';
      snapshot.sessions[0]!.capabilities.createSession = true;
    });

    await expect(page.getByTestId(SESSION_CREATE_IDS.profile)).toHaveValue(second.id);
    await expect(page.getByTestId(SESSION_CREATE_IDS.model)).toHaveValue('synthetic-model');
    await expect(page.getByTestId(SESSION_CREATE_IDS.effort)).toHaveValue(ReasoningEffort.Medium);
    await page.getByTestId(SESSION_CREATE_IDS.submit).click();
    await expect.poll(() => delivered.length).toBe(1);

    expect(delivered[0]!.action).toEqual({
      type: CommandActionType.CreateSession,
      provider: AgentProvider.Codex,
      cwd: '/synthetic/project',
      execution: {
        selection: { profileId: second.id, provider: AgentProvider.Codex, model: 'synthetic-model', effort: ReasoningEffort.Medium },
        expectedVersion: second.version,
      },
    });

    await expect(page.getByTestId(SESSION_CREATE_IDS.submit)).toBeDisabled();
    expect(delivered).toHaveLength(1);
  } finally {
    await companion.close();
  }
});
