import { expect, type Page } from '@playwright/test';
import { test, deviceFixture } from './support/relay-fixture.js';
import { sessionSnapshot } from './support/session-fixtures.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import {
  SESSION_FEED_IDS,
  SESSION_PAGE_IDS,
  SUBAGENT_IDS,
  SUBAGENT_VIEW_IDS,
  TOOL_ACTIVITY_IDS,
} from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import type { HistoryMessage, HistoryRead } from '@protocol';

const AGENT = 'synthetic-reviewer';

const transcript: HistoryMessage[] = [
  { id: 'agent-prompt', role: 'user', text: 'Review the synthetic parser.', occurredAt: 1700000000000 },
  {
    id: 'agent-call',
    role: 'assistant',
    text: 'npm test -- parser',
    occurredAt: 1700000001000,
    tool: { id: 'tool-1', phase: 'started', name: 'Bash', kind: 'command' },
  },
];

/** Answers the relay's history reads as a device would: the parent transcript is empty, the subagent's is `transcript`. */
function serveHistory(options: { unavailable?: boolean } = {}) {
  const f = deviceFixture(),
    ws = f.sockets[0]!,
    snapshot = sessionSnapshot(f.deviceId),
    session = snapshot.sessions[0]!,
    reads: HistoryRead[] = [];

  session.capabilities.historyWindow = true;
  session.capabilities.subagentHistory = true;
  session.status = 'running';

  session.subagents = [
    { id: AGENT, name: 'Reviewer', task: 'Review synthetic parser', status: 'running', updatedAt: 1 },
    { id: 'synthetic-tests', name: 'Tests', status: 'completed', updatedAt: 1 },
  ];

  ws.on('message', (raw) => {
    const frame = JSON.parse(String(raw)) as HistoryRead;

    if (frame.type !== 'history_read') return;
    reads.push(frame);
    const reply = { requestId: frame.requestId, sessionId: session.id, generation: session.generation };

    if (frame.agentId && options.unavailable) {
      ws.send(JSON.stringify({ type: 'history_done', ...reply, before: null, after: null, error: 'TRANSCRIPT_UNAVAILABLE' }));

      return;
    }

    for (const message of frame.agentId === AGENT ? transcript : [])
      ws.send(JSON.stringify({ type: 'history_item', ...reply, message }));
    ws.send(JSON.stringify({ type: 'history_done', ...reply, before: null, after: null }));
  });

  ws.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));

  return { f, snapshot, session, agentReads: () => reads.filter((read) => read.agentId).length };
}

const backButtonVisible = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { Telegram: { WebApp: { BackButton: { visible: boolean } } } }).Telegram.WebApp.BackButton.visible,
  );

async function openSubagent(page: Page, sessionId: string, prepare?: () => Promise<void>) {
  await identity(page, '801', 'en');
  await prepare?.();
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': sessionId }).click();
  await page.getByTestId(SUBAGENT_IDS.toggle).click();
  await byTestId(page, SUBAGENT_IDS.open, { 'agent-id': AGENT }).click();
}

test('opens a running subagent with its tool calls, updates it live and returns to the parent session', async ({ page }) => {
  const { session, agentReads } = serveHistory();

  await openSubagent(page, session.id);
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.title)).toHaveText('Reviewer');
  await expect(page.getByTestId(TOOL_ACTIVITY_IDS.detail)).toHaveText('npm test -- parser');
  await expect(page.getByTestId(TOOL_ACTIVITY_IDS.root)).toHaveAttribute('data-tool-phase', 'started');
  await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'agent-prompt' })).toBeVisible();

  transcript.push({ id: 'agent-result', role: 'user', text: '', occurredAt: 1700000002000, tool: { id: 'tool-1', phase: 'completed' } });
  await expect(page.getByTestId(TOOL_ACTIVITY_IDS.root)).toHaveAttribute('data-tool-phase', 'completed', { timeout: 10_000 });
  transcript.pop();

  await page.getByTestId(SUBAGENT_VIEW_IDS.back).click();
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toBeVisible();
  const reads = agentReads();

  await page.waitForTimeout(5_000);
  expect(agentReads()).toBe(reads);
});

test('pauses subagent polling while the page is hidden and the Telegram back button returns to the parent', async ({ page }) => {
  const { session, agentReads } = serveHistory();

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

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  const hidden = agentReads();

  await page.waitForTimeout(5_000);
  expect(agentReads()).toBe(hidden);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect.poll(agentReads).toBeGreaterThan(hidden);

  await page.evaluate(() => (window as unknown as { pressBack: () => void }).pressBack());
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
  await expect.poll(() => backButtonVisible(page)).toBe(false);
});

test('says the transcript is unavailable when the device has none', async ({ page }) => {
  const { session } = serveHistory({ unavailable: true });

  await openSubagent(page, session.id);
  await expect(page.getByTestId(SUBAGENT_VIEW_IDS.unavailable)).toContainText('Transcript unavailable');
});

test('keeps subagent rows non-clickable when the session cannot read subagent transcripts', async ({ page }) => {
  const { f, snapshot, session } = serveHistory();

  delete session.capabilities.subagentHistory;
  f.sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': session.id }).click();
  await page.getByTestId(SUBAGENT_IDS.toggle).click();
  await expect(page.getByTestId(SUBAGENT_IDS.row)).toHaveCount(2);
  await expect(page.getByTestId(SUBAGENT_IDS.open)).toHaveCount(0);
});
