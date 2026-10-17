import type { Page, WebSocketRoute } from '@playwright/test';

export async function controlledAppSocket(page: Page) {
  let current: WebSocketRoute | undefined;
  let upstream: WebSocketRoute | undefined;
  let available = true;

  await page.routeWebSocket('**/ws/app', (socket) => {
    if (!available) {
      socket.close();

      return;
    }

    current = socket;
    upstream = socket.connectToServer();
  });

  return {
    disconnect() {
      available = false;
      current?.close();
      upstream?.close();
    },
    reconnect() {
      available = true;
    },
  };
}
