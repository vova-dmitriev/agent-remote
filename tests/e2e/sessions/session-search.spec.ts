import { expect } from '@playwright/test';
import { test } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '@/pages/sessions/config/test-ids.js';

test('searches the session list on a phone by title, project, model or agent', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await identity(page, '801', 'en');
  await page.goto('/');

  const cards = page.getByTestId(SESSION_CARD_IDS.root);
  const search = page.getByTestId(SESSIONS_PAGE_IDS.search);

  await expect(cards).toHaveCount(4);

  await search.fill('sprint');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute('data-session-id', 'terminal-session');

  await search.fill('CODEX');
  await expect(cards).toHaveCount(2);

  await search.fill('nothing like this');
  await expect(cards).toHaveCount(0);
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.noMatches)).toContainText('nothing like this');
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.empty)).toHaveCount(0);

  await page.getByTestId(SESSIONS_PAGE_IDS.searchClear).tap();
  await expect(search).toHaveValue('');
  await expect(cards).toHaveCount(4);
});
