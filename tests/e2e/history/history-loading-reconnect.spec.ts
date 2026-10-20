import { expect } from '@playwright/test';
import { test, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { SESSION_AVAILABILITY_IDS } from '@/entities/session/config/availability-test-ids.js';

test('new-stream reconnect displays skeletons until authoritative history is restored', async ({ page }) => {
  let available = true;
  let connections = 0;

  let disconnect = () => {};

  await page.routeWebSocket('**/ws/app', (socket) => {
    if (!available) {
      socket.close();

      return;
    }

    const connection = ++connections;
    const upstream = socket.connectToServer();

    disconnect = () => {
      socket.close();
      upstream.close();
    };

    upstream.onMessage((message) => {
      const frame = JSON.parse(String(message));

      if (connection > 1 && frame.type === 'snapshot')
        frame.snapshot.cursor.streamId = 'synthetic-restored-stream';
      socket.send(JSON.stringify(frame));
    });
  });

  let release!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let requests = 0;

  await page.route('**/sessions/terminal-session/events**', async (route) => {
    if (++requests === 1) {
      await route.continue();

      return;
    }

    const response = await route.fetch();

    await gate;
    await route.fulfill({ response });
  });

  await publishMessages([
    { id: 'restored', role: 'assistant', text: 'Synthetic authoritative history', occurredAt: Date.now() },
  ]);

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText('Synthetic authoritative history');
  available = false;
  disconnect();

  await expect(page.getByTestId(SESSION_AVAILABILITY_IDS.trigger)).toHaveAttribute(
    'data-availability',
    'offline',
  );

  available = true;
  await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toBeVisible();
  await expect(page.getByTestId(SESSION_FEED_IDS.empty)).toHaveCount(0);
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveCount(0);

  await page.screenshot({
    path: 'artifacts/history-reconnect-loading-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });

  release();
  await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText('Synthetic authoritative history');
  await expect(page.getByTestId(SESSION_FEED_IDS.loading)).toHaveCount(0);
  await expect(page.getByTestId(SESSION_FEED_IDS.empty)).toHaveCount(0);
  expect(requests).toBe(2);
});
