import { expect } from '@playwright/test';
import { RuleScopeKind } from '@protocol';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { PERMISSION_IDS } from '@/pages/session/config/test-ids.js';
import { test, delivered } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { publishSnapshot } from '../product/device.js';

test('a command an owner\'s rule stopped shows ❗, the command and Always allow, which it sends', async ({ page }) => {
  await publishSnapshot((snapshot) => {
    snapshot.permissions = snapshot.permissions.map((permission) => ({
      ...permission,
      toolName: 'Bash',
      input: { command: 'psql -c "DROP TABLE synthetic"' },
      expiresAt: Date.now() + 600_000,
      rule: { id: 'ready-database', name: 'Suspicious database queries', scope: RuleScopeKind.Project },
    }));
  });

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();

  await expect(page.getByTestId(PERMISSION_IDS.title)).toHaveText('❗ A command your rule «Suspicious database queries» covers');
  await expect(page.getByTestId(PERMISSION_IDS.input)).toHaveText('psql -c "DROP TABLE synthetic"');
  await page.getByTestId(PERMISSION_IDS.allowAlways).click();

  await expect.poll(() => delivered.filter((command) => command.action.type === 'permission').length).toBe(1);
  expect(delivered[0]!.action).toEqual({ type: 'permission', requestId: 'permission-one', decision: 'allow_always' });
});
