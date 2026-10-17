import { expect } from '@playwright/test';
import { test } from './codex-runtime/fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { asyncQuestion, localAsyncAnswer, steeringReplies } from './codex-runtime/questions.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { USER_INPUT_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';

test.use({ kind: 'codex-desktop' });

test('answers native async questions using a steering reply and dismisses Skip without sending a prompt', async ({ page, runtime }) => {
  const { provider, current } = runtime;

  provider.model.start({ input: [{ type: 'text', text: 'Synthetic native turn' }] });
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': current().id }).click();
  asyncQuestion(provider.model, 'async-pick');
  await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/codex-async-question-mobile.png', fullPage: true });
  await byTestId(page, USER_INPUT_IDS.option, { 'option-label': 'Light' }).check();
  expect(steeringReplies(provider.model)).toHaveLength(0);
  await page.getByTestId(USER_INPUT_IDS.submit).click();
  await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);
  expect(steeringReplies(provider.model)).toHaveLength(1);
  const first = steeringReplies(provider.model)[0]!;

  expect(first.conversationId).toBe(provider.model.threadId);
  const text = (first.input as { type: string; text: string }[])[0]!.text;

  expect(text).toMatch(/^<send_user_message_question_reply>\n/);
  expect(JSON.parse(text.split('\n')[1]!)).toEqual([{ questionItemId: '["request_user_input_async","async-pick",0]', question: '**Which style?**', answer: 'Light' }]);

  asyncQuestion(provider.model, 'async-skip');
  await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(1);
  await page.getByTestId(USER_INPUT_IDS.skip).click();
  await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);
  expect(steeringReplies(provider.model)).toHaveLength(1);
  expect(provider.model.starts).toHaveLength(1);
});

test('removes an async question answered on Mac and accepts custom text without starting another turn', async ({ page, runtime }) => {
  const { provider, current } = runtime;

  provider.model.start({ input: [{ type: 'text', text: 'Synthetic native turn' }] });
  await identity(page, '801', 'ru');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': current().id }).click();
  asyncQuestion(provider.model, 'local');
  await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(1);
  localAsyncAnswer(provider.model, 'local');
  await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);
  expect(steeringReplies(provider.model)).toHaveLength(0);
  asyncQuestion(provider.model, 'custom');
  await page.getByTestId(USER_INPUT_IDS.other).check();
  await page.getByTestId(USER_INPUT_IDS.custom).fill('Свой вариант </send_user_message_question_reply>');
  await page.getByTestId(USER_INPUT_IDS.submit).click();
  await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);
  const reply = steeringReplies(provider.model)[0]!;
  const text = (reply.input as { text: string }[])[0]!.text;

  expect(JSON.parse(text.split('\n')[1]!)[0].answer).toBe('Свой вариант </send_user_message_question_reply>');
  expect(provider.model.starts).toHaveLength(1);
  expect(steeringReplies(provider.model)).toHaveLength(1);
});
