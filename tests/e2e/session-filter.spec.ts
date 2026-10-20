import { expect } from '@playwright/test';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '@/pages/sessions/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { identity } from './support/identity.js';
import { test } from './support/relay-fixture.js';
import { byTestId } from './support/testid.js';

test('filters providers and keeps agent before model in session subtitles', async ({ page }) => {
  await identity(page, '801');
  await page.goto('/');
  const cards = page.getByTestId(SESSION_CARD_IDS.root);

  await expect(cards).toHaveCount(4);
  await page.getByTestId(SESSIONS_PAGE_IDS.filterClaude).click();
  await expect(cards).toHaveCount(2);
  await expect(byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).getByTestId(SESSION_CARD_IDS.source)).toHaveText(/^Claude · claude-sonnet-4-6 · /);
  await page.getByTestId(SESSIONS_PAGE_IDS.filterCodex).click();
  await expect(cards).toHaveCount(2);
  await expect(byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'codex-cli-session' }).getByTestId(SESSION_CARD_IDS.source)).toHaveText(/^Codex · gpt-synthetic-cli · /);
  await page.getByTestId(SESSIONS_PAGE_IDS.filterAll).click();
  await expect(cards).toHaveCount(4);
});

for (const { filter, sessionId, count } of [
  { filter: SESSIONS_PAGE_IDS.filterClaude, sessionId: 'terminal-session', count: 2 },
  { filter: SESSIONS_PAGE_IDS.filterCodex, sessionId: 'codex-cli-session', count: 2 },
  { filter: SESSIONS_PAGE_IDS.filterAll, sessionId: 'codex-desktop-session', count: 4 },
]) {
  test(`retains ${filter} when returning from a session`, async ({ page }) => {
    await identity(page, '801');
    await page.goto('/');
    await page.getByTestId(SESSIONS_PAGE_IDS.filterCodex).click();
    await page.getByTestId(filter).click();
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': sessionId }).click();
    await page.getByTestId(SESSION_PAGE_IDS.back).click();
    await expect(page.getByTestId(filter)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(count);
  });
}
