import { expect } from '@playwright/test';
import { test, publishMessages } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { expectLoadedMessages, railMarker } from './support/rail.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { MARKDOWN_IDS } from '@/shared/ui/markdown/test-ids.js';

test('marker previews render Markdown and native envelopes without leaking metadata or moving the feed', async ({ page }) => {
  await publishMessages([
    { id: 'rich', role: 'assistant', text: '**Ready**\n\n- First\n- Second\n\n```ts\nconst answer = 42;\n```\n\n[Review](https://example.test/pr/1)', occurredAt: 1700000000000 },
    { id: 'paste', role: 'user', text: '<pasted_content id="synthetic">\n**PR ready**\n\n[Review](https://example.test/pr/1)\n</pasted_content>', occurredAt: 1700000000001 },
    { id: 'task', role: 'user', text: '<task-notification><task-id>private-id</task-id><tool-use-id>tool_demo</tool-use-id><output-file>/tmp/internal.log</output-file><status>completed</status><summary>**Review complete**</summary><result>- No blockers\n- Tests passed</result></task-notification>', occurredAt: 1700000000002 },
  ]);

  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  const feed = page.getByTestId(SESSION_FEED_IDS.root);

  await expectLoadedMessages(page, 3);
  await expect(page.getByTestId(SESSION_FEED_IDS.marker)).toHaveCount(3);
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'task' })).toBeVisible();
  const before = await feed.evaluate(node => node.scrollTop);

  await railMarker(page, 'rich').hover();
  const preview = page.getByTestId(SESSION_FEED_IDS.preview);
  const text = page.getByTestId(SESSION_FEED_IDS.previewText);

  await expect(preview).toBeVisible();
  await expect(text).toContainText('Ready');
  expect(await text.evaluate(node => node.innerHTML)).toContain('<strong>Ready</strong>');
  expect(await text.evaluate(node => node.innerHTML)).toContain('<ul>');
  expect(await text.getByTestId(MARKDOWN_IDS.code).evaluate(node => node.innerHTML)).toContain('hljs-keyword');
  await expect(text.getByTestId(MARKDOWN_IDS.copyCode)).toHaveCount(0);
  await expect(text.getByTestId(MARKDOWN_IDS.link)).not.toHaveAttribute('href');
  await expect(preview).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/chat-marker-rich-preview-mobile.png', fullPage: true });

  await railMarker(page, 'paste').hover();
  await expect(text).toContainText('PR ready');
  await expect(text).not.toContainText('pasted_content');
  expect(await text.evaluate(node => node.innerHTML)).toContain('<strong>PR ready</strong>');

  await page.keyboard.press('Tab');
  await railMarker(page, 'task').focus();
  await expect(text).toContainText('Review complete');
  await expect(text).toContainText('No blockers');
  await expect(text).not.toContainText('private-id');
  await expect(text).not.toContainText('tool_demo');
  await expect(text).not.toContainText('/tmp/internal.log');
  await expect(text).not.toContainText('task-notification');
  await expect(preview).toHaveCount(1);
  expect(await feed.evaluate(node => node.scrollTop)).toBe(before);
  await page.screenshot({ path: 'artifacts/chat-marker-task-preview-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 780 });
  const narrowMarker = railMarker(page, 'rich');

  await narrowMarker.hover();
  await expect(text).toContainText('Ready');
  const markerBounds = await narrowMarker.boundingBox();
  const previewBounds = await preview.boundingBox();

  expect(previewBounds!.x).toBeGreaterThan(markerBounds!.x + markerBounds!.width);
  expect(previewBounds!.x + previewBounds!.width).toBeLessThanOrEqual(320);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'artifacts/chat-marker-rich-preview-dark-320.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
});
