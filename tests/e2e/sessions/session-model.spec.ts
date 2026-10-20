import { expect } from '@playwright/test';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { identity } from '../support/relay/identity.js';
import { test } from '../support/relay/relay-fixture.js';
import { byTestId } from '../support/ui/testid.js';

for (const [language, unknown] of [
  ['en', 'Model unknown'],
  ['ru', 'Модель неизвестна'],
] as const) {
  test(`shows a model on every compact session row in ${language}`, async ({ page }) => {
    await identity(page, '801', language);
    await page.goto('/');

    for (const [id, model] of [
      ['terminal-session', 'claude-sonnet-4-6'],
      ['chat-session', unknown],
      ['codex-cli-session', 'gpt-synthetic-cli'],
      ['codex-desktop-session', 'gpt-synthetic-desktop'],
    ]) {
      const card = byTestId(page, SESSION_CARD_IDS.root, { 'session-id': id! });

      await expect(card.getByTestId(SESSION_CARD_IDS.model)).toHaveText(model!);
    }
  });
}
