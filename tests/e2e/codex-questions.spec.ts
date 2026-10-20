import { expect } from '@playwright/test';
import { test } from './codex-runtime/fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { syncQuestion, styleQuestion } from './codex-runtime/questions.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { USER_INPUT_IDS } from '@/pages/session/config/test-ids.js';

for (const kind of ['codex-cli', 'codex-desktop'] as const) {
  test.describe(kind + ' native questions', () => {
    test.use({ kind });

    test('selects an option, writes custom text and skips the exact original requests once', async ({ page, runtime }) => {
      const { provider, current } = runtime;

      provider.model.start({ input: [{ type: 'text', text: 'Synthetic native turn' }] });
      await identity(page, '801', 'en');
      await page.goto('/');
      await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': current().id }).click();
      syncQuestion(provider.model, 'pick');
      await expect(page.getByTestId(USER_INPUT_IDS.submit)).toBeDisabled();
      await byTestId(page, USER_INPUT_IDS.option, { 'question-id': 'style', 'option-label': 'Light' }).check();
      expect(provider.model.decisions).toHaveLength(0);
      await page.getByTestId(USER_INPUT_IDS.submit).click();
      await expect.poll(() => provider.model.decisions).toEqual([{ id: 'pick', answers: { style: { answers: ['Light'] } } }]);
      await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);

      syncQuestion(provider.model, 'custom');
      await page.getByTestId(USER_INPUT_IDS.other).check();
      await page.getByTestId(USER_INPUT_IDS.custom).fill('Synthetic custom style');
      await page.getByTestId(USER_INPUT_IDS.submit).click();
      await expect.poll(() => provider.model.decisions.at(-1)).toEqual({ id: 'custom', answers: { style: { answers: ['Synthetic custom style'] } } });
      await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);

      syncQuestion(provider.model, 'skip');
      await page.getByTestId(USER_INPUT_IDS.skip).click();
      await expect.poll(() => provider.model.decisions.at(-1)).toEqual({ id: 'skip', answers: {} });
      await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);
      expect(provider.model.starts).toHaveLength(1);
      expect(provider.model.decisions).toHaveLength(3);
    });

    test('fences disconnected questions and removes locally resolved or ended requests', async ({ page, runtime }) => {
      const { provider, current } = runtime;

      provider.model.start({ input: [{ type: 'text', text: 'Synthetic native turn' }] });
      await identity(page, '801', 'en');
      await page.goto('/');
      await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': current().id }).click();
      syncQuestion(provider.model, 'restore', [{ ...styleQuestion, options: null, isSecret: true }]);
      await expect(page.getByTestId(USER_INPUT_IDS.custom)).toHaveAttribute('type', 'password');
      await page.getByTestId(USER_INPUT_IDS.custom).fill('Synthetic private answer');
      provider.disconnect();
      await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);
      await runtime.connect();
      if (kind === 'codex-cli') syncQuestion(provider.model, 'fresh', [{ ...styleQuestion, options: null, isSecret: true }]);
      await expect(page.getByTestId(USER_INPUT_IDS.custom)).toHaveValue('');
      provider.model.resolve(kind === 'codex-cli' ? 'fresh' : 'restore');
      await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);
      syncQuestion(provider.model, 'end');
      await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(1);
      provider.model.finish();
      await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);
      expect(provider.model.decisions).toHaveLength(0);
      expect(provider.model.starts).toHaveLength(1);
    });
  });
}
