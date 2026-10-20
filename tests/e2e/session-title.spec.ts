import { expect } from '@playwright/test';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { identity } from './support/identity.js';
import { test } from './support/relay-fixture.js';
import { byTestId } from './support/testid.js';

test('shows the original session title in the list and detail while untitled sessions retain source IDs', async ({
  page,
}) => {
  await identity(page, '801', 'en');
  await page.goto('/');
  const titled = byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' });

  await expect(titled.getByTestId(SESSION_CARD_IDS.title)).toHaveText('Synthetic sprint fixes');
  await titled.click();
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toHaveText('Synthetic sprint fixes');
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  const untitled = byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'codex-cli-session' });

  await expect(untitled.getByTestId(SESSION_CARD_IDS.title)).toHaveText('codex-cli-th');
  await untitled.click();
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toHaveText('codex-cli-thread');
});
