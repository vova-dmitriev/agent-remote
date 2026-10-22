import { expect } from '@playwright/test';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, deviceFixture } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { expectLoadedMessages, jumpNear, railMarker } from '../support/ui/rail.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { TranscriptSources } from '@daemon/monitor/history.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import type { HistoryRead } from '@protocol';

const row = (i: number) =>
  JSON.stringify({
    // Every other row is the owner's, which the rail marks.
    type: i % 2 ? 'assistant' : 'user',
    sessionId: 'source',
    uuid: 'native-' + i,
    timestamp: new Date(1700000000000 + i).toISOString(),
    message: { content: 'Synthetic message ' + i + '\n\n' + ('Paragraph ' + i + '. ').repeat((i % 4) + 1) },
  }) + '\n';

test('native chat opens at the last page, prepends on demand, and reopens at its bookmark after new messages', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'native-window-e2e-'));

  const f = deviceFixture(),
    ws = f.sockets[0]!,
    snapshot = sessionSnapshot(f.deviceId);

  const session = snapshot.sessions[0]!,
    reads: HistoryRead[] = [];

  // Page reads; the rail's outline is read beside them.
  const pages = () => reads.filter((request) => request.direction !== 'outline');

  session.capabilities.historyWindow = true;

  const path = join(root, 'source.jsonl'),
    sources = new TranscriptSources(root);

  await writeFile(
    path,
    JSON.stringify({ type: 'progress', padding: 'x'.repeat(8 * 1024 * 1024) }) +
      '\n' +
      Array.from({ length: 420 }, (_, i) => row(i)).join(''),
  );

  sources.open(session.id, session.generation, path, 'source');

  ws.on('message', (raw) => {
    const frame = JSON.parse(String(raw)) as HistoryRead;

    if (frame.type !== 'history_read') return;
    reads.push(frame);

    void sources.page(frame).then((result) => {
      for (const message of result.messages)
        ws.send(
          JSON.stringify({
            type: 'history_item',
            requestId: frame.requestId,
            sessionId: session.id,
            generation: session.generation,
            message,
          }),
        );

      ws.send(
        JSON.stringify({
          type: 'history_done',
          requestId: frame.requestId,
          sessionId: session.id,
          generation: session.generation,
          before: result.before,
          after: result.after,
        }),
      );
    });
  });

  try {
    ws.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));

    await expect
      .poll(
        async () =>
          (
            await f.relay.db.pool.query(
              "SELECT data->'capabilities'->>'historyWindow' AS flag FROM sessions WHERE id='terminal-session'",
            )
          ).rows[0]?.flag,
      )
      .toBe('true');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await identity(page, '801', 'en');
    await page.goto('/');
    const open = () => byTestId(page, SESSION_CARD_IDS.root, { 'session-id': session.id }).click();

    await open();
    await expectLoadedMessages(page, 100);
    await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'native-419' })).toBeVisible();
    expect(pages().map((request) => request.direction)).toEqual(['latest']);
    // The rail marks every owner's message of the transcript, the 160 outside the loaded window too.
    await expect(page.getByTestId(SESSION_FEED_IDS.rail)).toHaveAttribute('data-marker-count', '210');
    expect(reads.some((request) => request.direction === 'outline')).toBe(true);
    await expect(page.getByTestId(SESSION_FEED_IDS.marker).first()).toHaveAttribute('data-message-id', 'native-0');
    // Earlier pages load on demand from the rail's cap.
    await byTestId(page, SESSION_FEED_IDS.railCap, { direction: 'before' }).click();
    await expectLoadedMessages(page, 200);
    const target = await jumpNear(page, 'native-320');
    const message = byTestId(page, SESSION_FEED_IDS.message, { 'message-id': target });

    await expect(message).toBeVisible();

    await page.getByTestId(SESSION_FEED_IDS.root).evaluate((node) => {
      node.scrollTop += 23;
    });

    const before = await message.evaluate((node) => node.getBoundingClientRect().top);

    await page.getByTestId(SESSION_PAGE_IDS.back).click();
    await appendFile(path, Array.from({ length: 250 }, (_, i) => row(i + 420)).join(''));
    await page.reload();
    await open();
    await expect(message).toBeVisible();

    await expect
      .poll(async () =>
        Math.abs((await message.evaluate((node) => node.getBoundingClientRect().top)) - before),
      )
      .toBeLessThan(3);

    await expect(railMarker(page, target)).toHaveAttribute(
      'aria-current',
      'true',
    );

    expect(pages().at(-1)?.direction).toBe('around');
    expect(pages().at(-1)?.anchor).toMatch(/^position:/);
    expect(pages()).toHaveLength(3);

    await page.getByTestId(SESSION_FEED_IDS.root).hover();
    await page.mouse.wheel(0, 50000);
    await expectLoadedMessages(page, 200);
    expect(pages().at(-1)?.direction).toBe('after');
    await page.getByTestId(SESSION_FEED_IDS.bottom).click();
    await expect(byTestId(page, SESSION_FEED_IDS.message, { 'message-id': 'native-669' })).toBeVisible();
    expect(pages().at(-1)?.direction).toBe('latest');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
