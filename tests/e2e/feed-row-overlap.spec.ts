import { expect, test, type Page } from '@playwright/test';
import { EventType, MessageRole } from '@protocol';
import { SESSION_SIDEBAR_IDS } from '../../apps/mini-app/src/widgets/session-sidebar/config/test-ids.js';
import { SESSION_FEED_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { byTestId } from './support/testid.js';
import { installDesktopBridge } from './support/desktop-bridge.js';
import { sessionSnapshot } from './support/session-fixtures.js';
import { box, expectLoadedMessages } from './support/rail.js';
import { scrollSettled } from './support/scroll-settled.js';

const deviceId = 'desktop-e2e-device';
const SESSION = 'terminal-session';
const COUNT = 120;
const MOTIONS = ['no-preference', 'reduce'] as const;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

/** Synthetic markdown of very uneven height: bullet lists with inline code and links, from one line to about twenty. */
const markdown = (index: number) => {
  const points = Array.from(
    { length: (index * 7) % 23 },
    (_, point) => `- Synthetic point ${point} with \`inline-${point}\` and [a link](https://example.com/${index}/${point}) plus text that wraps`,
  );

  return [`Synthetic message ${index}.`, points.join('\n'), `Closing paragraph ${index}.`].join('\n\n');
};

const history = Array.from({ length: COUNT }, (_, index) => {
  const message = {
    id: 'overlap-' + index,
    role: index % 2 ? MessageRole.Assistant : MessageRole.User,
    text: markdown(index),
    occurredAt: 1700000000000 + index,
  };

  return {
    version: 1,
    deviceId,
    streamId: 'desktop-e2e',
    seq: index + 1,
    eventId: 'overlap-event-' + index,
    sessionId: SESSION,
    occurredAt: message.occurredAt,
    type: EventType.Message,
    payload: message,
  };
});

/** Consecutive rendered rows whose boxes overlap, read one animation frame after the scroller has settled. */
async function overlappingRows(page: Page) {
  await scrollSettled(page.getByTestId(SESSION_FEED_IDS.root));

  return page.getByTestId(SESSION_FEED_IDS.virtualRow).evaluateAll(
    (nodes: HTMLElement[]) =>
      new Promise<string[]>((resolve) =>
        requestAnimationFrame(() => {
          const rows = nodes
            .map((node) => ({ index: Number(node.dataset.index), bounds: node.getBoundingClientRect() }))
            .sort((first, second) => first.index - second.index);

          resolve(
            rows.flatMap((row, position) => {
              const next = rows[position + 1];

              return next && next.index === row.index + 1 && row.bounds.bottom > next.bounds.top + 1
                ? [`row ${row.index} ends at ${row.bounds.bottom.toFixed(1)}, row ${next.index} starts at ${next.bounds.top.toFixed(1)}`]
                : [];
            }),
          );
        }),
      ),
  );
}

for (const motion of MOTIONS) {
  test(`rows never overlap after rail jumps into unmeasured rows (reduced motion: ${motion})`, async ({ page }) => {
    test.setTimeout(60000);
    await page.emulateMedia({ reducedMotion: motion });
    await installDesktopBridge(page, deviceId, sessionSnapshot(deviceId), {}, history);
    await page.goto('/desktop.html');
    await byTestId(page, SESSION_SIDEBAR_IDS.row, { 'session-id': SESSION }).click();
    await expectLoadedMessages(page, COUNT);
    expect(await overlappingRows(page)).toEqual([]);

    const markers = page.getByTestId(SESSION_FEED_IDS.marker);
    const count = await markers.count();
    const overlaps: string[] = [];

    // Far jumps both ways: a smooth jump renders rows on its way that it does not measure.
    for (const marker of [0, Math.floor(count / 3), count - 1, 2, Math.floor(count / 2)]) {
      await markers.nth(marker).click();
      overlaps.push(...(await overlappingRows(page)).map((overlap) => `marker ${marker}: ${overlap}`));
    }

    const track = await box(page.getByTestId(SESSION_FEED_IDS.railTrack));

    // Pointer clicks anywhere on the rail jump to the nearest marker.
    for (const point of [0.1, 0.8, 0.3]) {
      await page.mouse.click(track.x + track.width / 2, track.y + track.height * point);
      overlaps.push(...(await overlappingRows(page)).map((overlap) => `track ${point}: ${overlap}`));
    }

    expect(overlaps).toEqual([]);
  });
}
