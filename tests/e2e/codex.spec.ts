import { chooseLanguage } from './support/preferences.js';
import { expect } from '@playwright/test';
import { test, delivered } from './support/relay-fixture.js';
import { byTestId } from './support/testid.js';
import { identity } from './support/identity.js';
import { interruptSession } from './support/session-actions.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, PERMISSION_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { SHELL_IDS } from '../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';

for (const kind of ['codex-cli', 'codex-desktop'] as const) {
  test(`${kind} uses its own identity and routes commands through the relay`, async ({ page }) => {
    await identity(page, '801', 'ru');
    await page.goto('/');
    const card = byTestId(page, SESSION_CARD_IDS.root, { 'session-id': kind + '-session' });

    await expect(card).toContainText('Codex');
    await expect(card.getByTestId(SESSION_CARD_IDS.title)).toHaveText((kind + '-thread').slice(0, 12));
    await card.click();
    await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toHaveText((kind + '-thread').slice(0, 16));
    await expect(page.getByTestId(SESSION_PAGE_IDS.terminal)).toHaveCount(0);
    await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic Codex prompt ' + kind);
    await page.getByTestId(COMMAND_IDS.send).click();
    await expect(page.getByTestId(SHELL_IDS.receipt)).toContainText('Доставлено в сессию');
    await page.getByTestId(PERMISSION_IDS.allow).click();
    await interruptSession(page);
    await expect.poll(() => delivered.filter((command) => command.target.kind === kind).length).toBe(3);
    const commands = delivered.filter((command) => command.target.kind === kind);

    expect(commands.map((command) => command.action.type)).toEqual(['prompt', 'permission', 'interrupt']);

    for (const command of commands) {
      expect(command.target).toMatchObject({ kind, connectorId: kind, threadId: kind + '-thread' });
      expect(command.target).not.toHaveProperty('claudeSessionId');
      expect(command.sessionId).toBe(kind + '-session');
    }

    await page.getByTestId(SESSION_PAGE_IDS.back).click();
    await chooseLanguage(page, 'en');
    await expect(page.getByTestId(SHELL_IDS.receipt)).toContainText('Delivered to session');
    await card.click();
    await expect(page.getByTestId(COMMAND_IDS.label)).toHaveText('Message this session');
  });
}
