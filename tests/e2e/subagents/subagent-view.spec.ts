import { expect } from '@playwright/test';
import { test } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import {
  at,
  backButtonVisible,
  baseTranscript,
  call,
  expectNoSubagentRead,
  openSubagent,
  serveHistory,
  setVisibility,
} from '../support/fixtures/subagent-fixtures.js';
import {
  SESSION_FEED_IDS,
  SESSION_PAGE_IDS,
  SUBAGENT_IDS,
  SUBAGENT_VIEW_IDS,
  TOOL_ACTIVITY_IDS,
} from '@/pages/session/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SUBAGENT_POLL_INTERVAL_MS } from '@/pages/session/config/subagent.js';

test('opens a running subagent with its tool calls in the session layout, updates it live and returns to the parent', async ({
  page,
}) => {
  const transcript = baseTranscript();
  const { session } = serveHistory(transcript);

  await openSubagent(page, session.id);
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.title)).toHaveText('Reviewer');
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.status)).toHaveText('Subagent: Running');
  await expect(page.getByTestId(TOOL_ACTIVITY_IDS.detail)).toHaveText('npm test -- parser');
  await expect(page.getByTestId(TOOL_ACTIVITY_IDS.root)).toHaveAttribute('data-tool-phase', 'started');
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'agent-prompt' })).toBeVisible();
  await expect(page.getByTestId(SESSION_FEED_IDS.marker)).toHaveCount(2);

  const task = (await page.getByTestId(SUBAGENT_VIEW_IDS.task).boundingBox())!;
  const feed = (await page.getByTestId(SESSION_FEED_IDS.frame).boundingBox())!;

  expect(task.y + task.height).toBeLessThanOrEqual(feed.y);
  expect(feed.y + feed.height).toBeGreaterThan(page.viewportSize()!.height * 0.85);

  transcript.push({ id: 'agent-result', role: 'user', text: '', occurredAt: at(3), tool: { id: 'tool-agent-call', phase: 'completed' } });
  await page.clock.fastForward(SUBAGENT_POLL_INTERVAL_MS);
  await expect(page.getByTestId(TOOL_ACTIVITY_IDS.root)).toHaveAttribute('data-tool-phase', 'completed');

  await page.getByTestId(SUBAGENT_VIEW_IDS.back).click();
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
  await expectNoSubagentRead(page);
});

test('follows new tool lines while the reader is at the bottom', async ({ page }) => {
  const transcript = [...baseTranscript(), ...Array.from({ length: 30 }, (_, index) => call('step-' + index, 10 + index, 'step ' + index))];
  const { session } = serveHistory(transcript);

  await openSubagent(page, session.id);
  await expect(byTestId(page, TOOL_ACTIVITY_IDS.root, { 'message-id': 'step-29' })).toBeInViewport();
  transcript.push(call('step-new', 100, 'the newest step'));
  await page.clock.fastForward(SUBAGENT_POLL_INTERVAL_MS);
  await expect(byTestId(page, TOOL_ACTIVITY_IDS.root, { 'message-id': 'step-new' })).toBeInViewport();
});

test('pauses polling while the page is hidden and the Telegram back button returns to the parent', async ({ page }) => {
  const { session, agentReads } = serveHistory(baseTranscript());

  await openSubagent(page, session.id, async () => {
    await page.addInitScript(() => {
      const handlers = new Set<() => void>();
      const app = (window as unknown as { Telegram: { WebApp: Record<string, unknown> } }).Telegram.WebApp;

      const button = {
        visible: false,
        show: () => {
          button.visible = true;
        },
        hide: () => {
          button.visible = false;
        },
        onClick: (handler: () => void) => handlers.add(handler),
        offClick: (handler: () => void) => handlers.delete(handler),
      };

      app.BackButton = button;
      (window as unknown as { pressBack: () => void }).pressBack = () => handlers.forEach((handler) => handler());
    });
  });

  await expect(page.getByTestId(TOOL_ACTIVITY_IDS.root)).toBeVisible();
  await expect.poll(() => backButtonVisible(page)).toBe(true);
  await setVisibility(page, 'hidden');
  const hidden = agentReads();

  await expectNoSubagentRead(page);
  await setVisibility(page, 'visible');
  await expect.poll(agentReads).toBeGreaterThan(hidden);

  await page.evaluate(() => (window as unknown as { pressBack: () => void }).pressBack());
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
  await expect.poll(() => backButtonVisible(page)).toBe(false);
});

test('says the transcript is unavailable, stops polling it, and retries on request', async ({ page }) => {
  const options = { unavailable: true };
  const { session, agentReads } = serveHistory(baseTranscript(), options);

  await openSubagent(page, session.id);
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.unavailable)).toContainText('Transcript unavailable');
  await expect.poll(agentReads).toBe(1);
  await expectNoSubagentRead(page);

  options.unavailable = false;
  await page.getByTestId(SUBAGENT_VIEW_IDS.retry).click();
  await expect(page.getByTestId(TOOL_ACTIVITY_IDS.root)).toBeVisible();
});

test('keeps subagent rows non-clickable when the session cannot read subagent transcripts', async ({ page }) => {
  const { f, snapshot, session } = serveHistory(baseTranscript());

  delete session.capabilities.subagentHistory;
  f.sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': session.id }).click();
  await page.getByTestId(SUBAGENT_IDS.toggle).click();
  await expect(page.getByTestId(SUBAGENT_IDS.row)).toHaveCount(2);
  await expect(page.getByTestId(SUBAGENT_IDS.open)).toHaveCount(0);
});
