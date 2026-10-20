import { expect, type Page } from '@playwright/test';
import { deviceFixture } from './relay-fixture.js';
import { sessionSnapshot } from './session-fixtures.js';
import { identity } from './identity.js';
import { byTestId } from './testid.js';
import { SUBAGENT_IDS } from '../../../apps/mini-app/src/pages/session/config/test-ids.js';
import { SESSION_CARD_IDS } from '../../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SUBAGENT_POLL_BACKOFF_MAX_MS } from '../../../apps/mini-app/src/pages/session/config/subagent.js';
import type { HistoryMessage, HistoryRead } from '@protocol';

const AGENT = 'synthetic-reviewer';

export const at = (offset: number) => 1700000000000 + offset * 1000;

/** Transcript items carry a page cursor, as the daemon's transcript reader sets one on every item. */
const cursor = (offset: number) => ({ historyCursor: 'position:' + offset });

export const call = (id: string, offset: number, text: string): HistoryMessage => ({
  id,
  role: 'assistant',
  text,
  occurredAt: at(offset),
  ...cursor(offset),
  tool: { id: 'tool-' + id, phase: 'started', name: 'Bash', kind: 'command' },
});

/** A fresh synthetic transcript per test: a prompt, an answer and one running tool call. */
export const baseTranscript = (): HistoryMessage[] => [
  { id: 'agent-prompt', role: 'user', text: 'Review the synthetic parser.', occurredAt: at(0), ...cursor(0) },
  { id: 'agent-plan', role: 'assistant', text: 'Running the parser tests.', occurredAt: at(1), ...cursor(1) },
  call('agent-call', 2, 'npm test -- parser'),
];

/** Answers the relay's history reads as a device would: the parent transcript is empty, the subagent's is `transcript`. */
export function serveHistory(transcript: HistoryMessage[], options: { unavailable?: boolean } = {}) {
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

    for (const message of frame.agentId === AGENT ? transcript.slice(-100) : [])
      ws.send(JSON.stringify({ type: 'history_item', ...reply, message }));
    ws.send(JSON.stringify({ type: 'history_done', ...reply, before: null, after: null }));
  });

  ws.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));

  return { f, snapshot, session, agentReads: () => reads.filter((read) => read.agentId).length };
}

export const backButtonVisible = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { Telegram: { WebApp: { BackButton: { visible: boolean } } } }).Telegram.WebApp.BackButton.visible,
  );

export async function openSubagent(page: Page, sessionId: string, prepare?: () => Promise<void>) {
  await identity(page, '801', 'en');
  await prepare?.();
  await page.clock.install();
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': sessionId }).click();
  await page.getByTestId(SUBAGENT_IDS.toggle).click();
  await byTestId(page, SUBAGENT_IDS.open, { 'agent-id': AGENT }).click();
}

/** Jumps past every poll delay (including backoff) and confirms that no subagent read leaves the page. */
export async function expectNoSubagentRead(page: Page) {
  const request = page
    .waitForRequest((candidate) => candidate.url().includes('agentId='), { timeout: 1_000 })
    .then(
      () => true,
      () => false,
    );

  await page.clock.fastForward(SUBAGENT_POLL_BACKOFF_MAX_MS);
  expect(await request).toBe(false);
}

export async function setVisibility(page: Page, state: DocumentVisibilityState) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}
