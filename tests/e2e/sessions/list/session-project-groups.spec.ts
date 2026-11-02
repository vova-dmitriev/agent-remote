import { expect } from '@playwright/test';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '@/pages/sessions/config/test-ids.js';
import { identity } from '../../support/relay/identity.js';
import { deviceFixture, test } from '../../support/relay/relay-fixture.js';
import { sessionSnapshot } from '../../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 390, height: 844 } });

test('groups the session list by project, and a collapsed group stays collapsed but opens for a search', async ({ page }) => {
  await identity(page, '801', 'en');
  const { sockets, deviceId } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);

  snapshot.sessions.forEach((session, index) => {
    session.cwd = index === 0 ? '/synthetic/alpha' : '/synthetic/beta';
    delete session.pinned;
    session.lastMessageAt = 100 - index;
  });

  await page.goto('/');
  sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));

  const beta = page.getByTestId(SESSIONS_PAGE_IDS.group).last();
  const cards = beta.getByTestId(SESSION_CARD_IDS.root);
  const inBeta = snapshot.sessions.length - 1;

  await expect(page.getByTestId(SESSIONS_PAGE_IDS.group)).toHaveCount(2);
  await expect(beta).toHaveAttribute('data-group', '/synthetic/beta');
  await expect(cards).toHaveCount(inBeta);
  await expect(beta.getByTestId(SESSIONS_PAGE_IDS.groupCount)).toHaveText(String(inBeta));

  // Every card fills the list, so the status dots line up however long a card's text is.
  const widths = await page
    .getByTestId(SESSION_CARD_IDS.root)
    .evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getBoundingClientRect().width))]);

  expect(widths).toHaveLength(1);

  await beta.getByTestId(SESSIONS_PAGE_IDS.groupToggle).click();
  await expect(cards).toHaveCount(0);

  await page.getByTestId(SESSIONS_PAGE_IDS.search).fill('a');
  await expect(beta).toHaveAttribute('data-open', 'true');
  await page.getByTestId(SESSIONS_PAGE_IDS.search).fill('');

  await page.reload();
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.root)).toBeVisible();
  await expect(cards).toHaveCount(0);

  await beta.getByTestId(SESSIONS_PAGE_IDS.groupToggle).click();
  await expect(cards).toHaveCount(inBeta);
});
