import { expect } from '@playwright/test';
import { FrameType, type Session } from '@protocol';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { SESSIONS_PAGE_IDS } from '@/pages/sessions/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { identity } from '../support/relay/identity.js';
import { deviceFixture, test } from '../support/relay/relay-fixture.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('the mobile session list pages past sixty rows and keeps an older selection across snapshots', async ({ page }) => {
  await identity(page, '801');

  const { sockets, deviceId } = deviceFixture();
  const socket = sockets[0]!;
  const snapshot = sessionSnapshot(deviceId);

  const sessions = Array.from({ length: 65 }, (_, index): Session => {
    const source = snapshot.sessions[index < snapshot.sessions.length ? index : 0]!;

    const id = index < snapshot.sessions.length ? source.id : `paged-session-${index + 1}`;

    // Each page row is its own conversation: the list shows one row per conversation.
    return {
      ...source,
      id,
      ...(index < snapshot.sessions.length ? {} : { claudeSessionId: id, target: { ...source.target, claudeSessionId: id } as Session['target'] }),
      title: `Page session ${String(index + 1).padStart(2, '0')}`,
      lastMessageAt: 65 - index,
    };
  });

  socket.on('message', (raw) => {
    const frame = JSON.parse(String(raw));

    if (frame.type !== FrameType.SessionListRead) return;
    const offset = frame.cursor ? Number(frame.cursor) : 0;
    const end = offset + 30;

    socket.send(JSON.stringify({
      type: FrameType.SessionListResult,
      requestId: frame.requestId,
      reply: { ok: true, page: { sessions: sessions.slice(offset, end), nextCursor: end < sessions.length ? String(end) : null } },
    }));
  });

  await page.goto('/');
  const list = page.getByTestId(SESSIONS_PAGE_IDS.list);
  const cards = page.getByTestId(SESSION_CARD_IDS.root);

  await expect(cards).toHaveCount(30);
  await list.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  await expect(cards).toHaveCount(60);
  await list.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  await expect(cards).toHaveCount(65);

  const older = page.getByTestId(SESSION_CARD_IDS.root).filter({ hasText: 'Page session 65' });

  await older.click();
  await expect(page.getByTestId(SESSION_PAGE_IDS.root)).toBeVisible();
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toContainText('Page session 65');

  socket.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toContainText('Page session 65');
  await expect(page.getByTestId(SESSIONS_PAGE_IDS.root)).toHaveCount(0);
});
