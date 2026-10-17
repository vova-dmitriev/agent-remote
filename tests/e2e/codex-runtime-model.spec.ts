import { expect } from '@playwright/test';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { test } from './codex-runtime/fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';

for (const kind of ['codex-cli', 'codex-desktop'] as const) {
  test.describe(kind + ' native session model', () => {
    test.use({ kind });

    test('relays the exact native model and subsequent model changes into the list row', async ({
      page,
      runtime,
    }) => {
      await identity(page, '801', 'en');
      await page.goto('/');
      const card = byTestId(page, SESSION_CARD_IDS.root, { 'session-id': runtime.current().id });

      await expect(card.getByTestId(SESSION_CARD_IDS.model)).toHaveText('gpt-synthetic-runtime');
      runtime.provider.model.modelName = 'gpt-synthetic-next';
      runtime.provider.model.notify('model/rerouted', { toModel: 'gpt-synthetic-next', turnId: 'synthetic' });
      runtime.provider.model.emit('change');
      await expect(card.getByTestId(SESSION_CARD_IDS.model)).toHaveText('gpt-synthetic-next');
      expect(runtime.provider.model.starts).toHaveLength(0);
    });
  });
}
