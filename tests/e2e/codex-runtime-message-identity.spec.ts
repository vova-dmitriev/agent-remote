import { expect } from '@playwright/test';
import { test } from './codex-runtime/fixture.js';
import type { Data } from './codex-runtime/model.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, SESSION_FEED_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { SHELL_IDS } from '../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';

test.use({ kind: 'codex-desktop' });

test('reconciles preliminary Desktop input and preserves a genuine repeated prompt after reload', async ({
  page,
  runtime,
}) => {
  const { model } = runtime.provider;
  const prompt = 'Synthetic repeated prompt';
  const messages = ['Synthetic original question', 'Synthetic original answer'];

  model.deferUserInput = true;
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': runtime.current().id }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill(prompt);
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(SHELL_IDS.receipt)).toContainText('Delivered to session');
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText([...messages, prompt]);
  expect(model.starts).toHaveLength(1);

  const items = model.turns.at(-1)!.items as Data[];

  items.push({ id: 'native-canonical', type: 'userMessage', content: model.starts[0]!.input });
  model.emit('change');
  model.stream('Synthetic first acknowledgment');
  messages.push(prompt, 'Synthetic first acknowledgment');
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText(messages);
  expect(model.starts).toHaveLength(1);
  model.finish();
  await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Ready for a message');

  model.deferUserInput = false;
  await page.getByTestId(COMMAND_IDS.prompt).fill(prompt);
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => model.starts.length).toBe(2);
  model.stream('Synthetic second acknowledgment');
  messages.push(prompt, 'Synthetic second acknowledgment');
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText(messages);
  model.finish();
  await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Ready for a message');
  await page.reload();
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': runtime.current().id }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText(messages);
  expect(model.starts).toHaveLength(2);
});
