import { expect } from '@playwright/test';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { PERMISSION_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { test, delivered } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { publishSnapshot } from './product/device.js';

for (const decision of ['allow', 'deny'] as const) {
  test(`${decision} dispatches once and a source resolution removes the permission`, async ({ page }) => {
    await identity(page, '801', 'en');
    await page.goto('/');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
    await page.getByTestId(PERMISSION_IDS[decision]).click();

    await expect
      .poll(() => delivered.filter((command) => command.action.type === 'permission').length)
      .toBe(1);

    expect(delivered[0]!.action).toEqual({ type: 'permission', requestId: 'permission-one', decision });

    await publishSnapshot((snapshot) => {
      snapshot.permissions = snapshot.permissions.filter(
        (permission) => permission.requestId !== 'permission-one',
      );
    });

    await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(0);
    await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeEnabled();
    expect(delivered).toHaveLength(1);
  });
}

test('permission countdown expiry disables both decisions before a refreshed snapshot removes the card', async ({
  page,
}) => {
  await publishSnapshot((snapshot) => {
    snapshot.permissions = snapshot.permissions.filter(
      (permission) => permission.sessionId === 'terminal-session',
    );

    snapshot.permissions[0]!.expiresAt = Date.now() + 2000;
  });

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(PERMISSION_IDS.remaining)).toHaveText('0 s');
  await expect(page.getByTestId(PERMISSION_IDS.allow)).toBeDisabled();
  await expect(page.getByTestId(PERMISSION_IDS.deny)).toBeDisabled();
  expect(delivered).toHaveLength(0);

  await publishSnapshot((snapshot) => {
    snapshot.permissions = [];
  });

  await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(0);
});

for (const reason of ['local resolution', 'turn completion', 'session generation change'] as const) {
  test(`${reason} removes obsolete permission controls without sending a remote decision`, async ({
    page,
  }) => {
    await identity(page, '801', 'en');
    await page.goto('/');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
    await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(1);

    await publishSnapshot((snapshot) => {
      snapshot.permissions = [];
      const session = snapshot.sessions.find((item) => item.id === 'terminal-session')!;

      if (reason === 'turn completion') session.status = 'idle';

      if (reason === 'session generation change') {
        session.generation = 'next-generation';
        snapshot.terminal = null;
      }
    });

    await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(0);
    expect(delivered).toHaveLength(0);
  });
}
