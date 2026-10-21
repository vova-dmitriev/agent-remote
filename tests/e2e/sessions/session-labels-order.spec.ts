import { expect } from '@playwright/test';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { RENAME_SESSION_IDS as IDS } from '@/features/rename-session/config/test-ids.js';
import { identity } from '../support/relay/identity.js';
import { test, publishMessages, deviceFixture } from '../support/relay/relay-fixture.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { byTestId } from '../support/ui/testid.js';
import { RelayProtocolFeature } from '@protocol';

test.describe('relay-owned session labels', () => {
  // This scenario verifies the relay label fallback when the connected daemon predates SessionRename.
  test.use({ relayProtocolVersion: RelayProtocolFeature.SessionRename - 1 });

  test('renames from the session title and survives a stale snapshot and reload', async ({ page }) => {
    await identity(page, '801');
    await page.goto('/');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
    await page.getByTestId(IDS.trigger).click();
    await page.getByTestId(IDS.input).fill('Synthetic renamed session');
    await page.getByTestId(IDS.save).click();
    await expect(page.getByTestId(IDS.root)).toHaveCount(0);
    await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toHaveText('Synthetic renamed session');
    const f = deviceFixture();

    f.sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot: sessionSnapshot(f.deviceId), connectors: [] }));
    await page.getByTestId(SESSION_PAGE_IDS.back).click();
    await page.reload();
    await expect(byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).getByTestId(SESSION_CARD_IDS.title)).toHaveText('Synthetic renamed session');
  });
});

test('native session rename is reflected by the device snapshot and survives reload', async ({ page }) => {
  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(IDS.trigger).click();
  await page.getByTestId(IDS.input).fill('Synthetic native rename');
  await page.getByTestId(IDS.save).click();
  await expect(page.getByTestId(IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toHaveText('Synthetic native rename');
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await page.reload();
  await expect(byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).getByTestId(SESSION_CARD_IDS.title)).toHaveText('Synthetic native rename');
});

test('orders by last message, handles live reordering and ignores status timestamps', async ({ page }) => {
  await publishMessages([{ id: 'old', role: 'assistant', text: 'Old', occurredAt: 200 }], 'terminal-session');
  await publishMessages([{ id: 'new', role: 'assistant', text: 'New', occurredAt: 400 }], 'codex-cli-session');
  await identity(page, '801');
  await page.goto('/');
  const cards = page.getByTestId(SESSION_CARD_IDS.root);

  await expect(cards.first()).toHaveAttribute('data-session-id', 'codex-cli-session');
  await publishMessages([{ id: 'latest', role: 'user', text: 'Latest', occurredAt: 600 }], 'terminal-session');
  await expect(cards.first()).toHaveAttribute('data-session-id', 'terminal-session');
  await publishMessages([{ id: 'late-history', role: 'user', text: 'Older history', occurredAt: 100 }], 'codex-cli-session');
  await expect(cards.first()).toHaveAttribute('data-session-id', 'terminal-session');
});
