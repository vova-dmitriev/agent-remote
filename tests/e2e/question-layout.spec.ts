import { expect } from '@playwright/test';
import { test } from './codex-runtime/fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { asyncQuestion, steeringReplies } from './codex-runtime/questions.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { USER_INPUT_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';

test.use({ kind: 'codex-desktop' });

test('keeps question Send and Skip visible without scrolling to the bottom of a long card', async ({ page, runtime }) => {
  await page.setViewportSize({ width: 390, height: 400 });
  const { provider, current } = runtime;

  provider.model.start({ input: [{ type: 'text', text: 'Synthetic native turn' }] });
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': current().id }).click();
  asyncQuestion(provider.model, 'long-question', 'Choose a synthetic option. '.repeat(25), ['First synthetic option with a detailed label', 'Second synthetic option with a detailed label']);
  await expect(page.getByTestId(USER_INPUT_IDS.root)).toBeVisible();
  await expect(page.getByTestId(USER_INPUT_IDS.submit)).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId(USER_INPUT_IDS.skip)).toBeInViewport({ ratio: 1 });
  await byTestId(page, USER_INPUT_IDS.option, { 'option-label': 'First synthetic option with a detailed label' }).check();
  await expect(page.getByTestId(USER_INPUT_IDS.submit)).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId(USER_INPUT_IDS.submit)).toBeEnabled();
  await page.getByTestId(USER_INPUT_IDS.submit).click();
  await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);
  expect(steeringReplies(provider.model)).toHaveLength(1);
});
