import { expect } from '@playwright/test';
import type { Session } from '../../packages/protocol/src/index.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { PERMISSION_IDS, SESSION_PAGE_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { test, delivered } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { installSource, sourceCases } from './product/sources.js';

for (const source of sourceCases) {
  test(`${source.name} exposes only its advertised source capabilities`, async ({ page }) => {
    await installSource(source);
    await identity(page, '801', 'en');
    await page.goto('/');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'matrix-session' }).click();
    await expect(page.getByTestId(SESSION_PAGE_IDS.terminal)).toHaveCount(source.terminal ? 1 : 0);
    await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(source.permission ? 1 : 0);
    await expect(page.getByTestId(COMMAND_IDS.actionsTrigger)).toHaveCount(source.writable ? 1 : 0);

    if (source.writable) {
      await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeEnabled();
      await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic capability test');
      await page.getByTestId(COMMAND_IDS.send).click();
      await expect.poll(() => delivered.length).toBe(1);
      expect(delivered[0]!.target.kind).toBe(source.kind);
    } else {
      await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeDisabled();
      await expect(page.getByTestId(COMMAND_IDS.send)).toBeDisabled();
      expect(delivered).toHaveLength(0);
    }

    await expect(page.getByTestId(COMMAND_IDS.connectionHint)).toHaveCount(
      source.name === 'native hooks' ? 1 : 0,
    );
  });
}

const blockedStates: { name: string; override: Partial<Session>; interrupt: boolean }[] = [
  { name: 'unverified binding', override: { binding: 'unverified' }, interrupt: false },
  { name: 'source needs setup', override: { integrationState: 'needs_setup' }, interrupt: false },
  { name: 'source disconnected', override: { integrationState: 'disconnected' }, interrupt: false },
  { name: 'ended session', override: { status: 'ended' }, interrupt: false },
];

for (const state of blockedStates) {
  test(`${state.name} blocks prompts independently of advertised PTY capability`, async ({ page }) => {
    await installSource(sourceCases[1], state.override);
    await identity(page, '801', 'en');
    await page.goto('/');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'matrix-session' }).click();
    await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeDisabled();
    await expect(page.getByTestId(COMMAND_IDS.send)).toBeDisabled();
    await page.getByTestId(COMMAND_IDS.actionsTrigger).click();

    if (state.interrupt) await expect(page.getByTestId(COMMAND_IDS.interrupt)).toBeEnabled();
    else await expect(page.getByTestId(COMMAND_IDS.interrupt)).toBeDisabled();

    expect(delivered).toHaveLength(0);
  });
}
