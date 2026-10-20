import { expect, type Page } from '@playwright/test';
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
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { delivered, deviceFixture, setCommandOutcome, test } from '../support/relay/relay-fixture.js';
import { publishSnapshot } from '../product/device.js';
import { profileCompanion } from '../accounts/companion.js';
import { readyLaunchProfile } from './fixture.js';
import { FixtureCommandOutcome } from '../runtime/command-outcome-values.js';

async function choose(page: Page, trigger: string, option: string, value: string) {
  await page.getByTestId(trigger).click();
  await byTestId(page, option, { value }).click();
  await expect(page.getByTestId(trigger)).toHaveAttribute('data-value', value);
}

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
    await expect(page.getByTestId(SESSION_CREATE_IDS.profile.trigger)).toHaveAttribute('data-value', '');
    await choose(page, SESSION_CREATE_IDS.profile.trigger, SESSION_CREATE_IDS.profileOption, second.id);
    await expect(page.getByTestId(SESSION_CREATE_IDS.profileStatus)).toContainText('Synthetic account B');
    await expect(page.getByTestId(SESSION_CREATE_IDS.submit)).toBeDisabled();
    await choose(page, SESSION_CREATE_IDS.model.trigger, SESSION_CREATE_IDS.modelOption, 'synthetic-model');
    await choose(page, SESSION_CREATE_IDS.effort.trigger, SESSION_CREATE_IDS.effortOption, ReasoningEffort.Medium);
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

    await expect(page.getByTestId(SESSION_CREATE_IDS.profile.trigger)).toHaveAttribute('data-value', second.id);
    await expect(page.getByTestId(SESSION_CREATE_IDS.model.trigger)).toHaveAttribute('data-value', 'synthetic-model');
    await expect(page.getByTestId(SESSION_CREATE_IDS.effort.trigger)).toHaveAttribute('data-value', ReasoningEffort.Medium);
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
