import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createMessaging } from '../apps/server/src/infrastructure/messaging.js';
import { RetentionQueue } from '../apps/server/src/maintenance/retention-queue.js';
import { NotificationQueue } from '../apps/server/src/notifications/queue.js';

afterEach(() => {
  vi.restoreAllMocks();
});

it('closes the retention queue and the shared Redis client when the notification queue fails to close', async () => {
  const messaging = await createMessaging(
    process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56380',
    'messaging-close-' + randomUUID(),
  );

  const close = NotificationQueue.prototype.close;

  vi.spyOn(NotificationQueue.prototype, 'close').mockImplementation(async function (this: NotificationQueue) {
    await close.call(this);
    throw new Error('QUEUE_CLOSE_FAILED');
  });

  const closeRetention = RetentionQueue.prototype.close;
  let retentionClosed = false;

  vi.spyOn(RetentionQueue.prototype, 'close').mockImplementation(async function (this: RetentionQueue) {
    await closeRetention.call(this);
    retentionClosed = true;
  });

  await expect(messaging.close()).rejects.toThrow('QUEUE_CLOSE_FAILED');
  // The retention queue finished closing before `close()` reported the failure.
  expect(retentionClosed).toBe(true);
  // The shared client is disconnected: it no longer answers.
  await expect(messaging.health()).rejects.toThrow();
});
