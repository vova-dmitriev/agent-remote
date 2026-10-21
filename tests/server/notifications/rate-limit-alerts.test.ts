import { randomUUID } from 'node:crypto';
import { UsageProvider } from '@protocol';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { NotificationKind } from '@server/domain/notifications.js';
import { NotificationDelivery } from '@server/notifications/delivery.js';
import { rateLimitAlerts } from '@server/notifications/limits/rate-limits.js';
import { NotificationRepository } from '@server/notifications/repositories/notifications.js';
import { databaseFixture } from '../../helpers/relay/database.js';

const NOW = Date.parse('2026-10-21T10:00:00Z');
const HOUR = 3_600_000;

const window = (usedPercent: number, resetsAt = NOW + 4 * HOUR - 330, windowMinutes = 300) => ({
  provider: UsageProvider.Claude,
  windowMinutes,
  usedPercent,
  resetsAt,
  observedAt: NOW,
});

it('alerts once per window cycle at the highest threshold reached, and schedules the reset', () => {
  expect(rateLimitAlerts([window(79)], NOW)).toEqual([]);

  const [high, reset] = rateLimitAlerts([window(83)], NOW);

  expect(high).toMatchObject({ kind: NotificationKind.RateLimit, at: NOW, payload: { usedPercent: 83 } });
  expect(reset).toMatchObject({ kind: NotificationKind.RateLimitReset, at: NOW + 4 * HOUR - 330 });

  // The same cycle read again a moment later, with its reset reported a few milliseconds off, keeps its keys.
  expect(rateLimitAlerts([window(84, NOW + 4 * HOUR - 120)], NOW).map((alert) => alert.key)).toEqual([
    high!.key,
    reset!.key,
  ]);

  expect(rateLimitAlerts([window(96)], NOW)[0]!.key).not.toBe(high!.key);
  expect(rateLimitAlerts([window(83, NOW + 9 * HOUR)], NOW)[0]!.key).not.toBe(high!.key);
});

it('ignores a reading whose window already reset', () => {
  expect(rateLimitAlerts([window(99, NOW - 1)], NOW)).toEqual([]);
});

let fixture: Awaited<ReturnType<typeof databaseFixture>>;

beforeAll(async () => {
  fixture = await databaseFixture();

  await fixture.db.pool.query(
    "INSERT INTO users(id,telegram_id,created_at,private_chat_id) VALUES('limits','limits',0,'limits')",
  );

  await fixture.db.pool.query("INSERT INTO user_preferences(owner_id,language) VALUES('limits','ru')");
});

afterAll(async () => {
  await fixture?.close();
});

it('tells the owner how much of which window is used and when it resets, then that it reset', async () => {
  const outbox = new NotificationRepository(fixture.db);
  const calls: { text: string }[] = [];

  const delivery = new NotificationDelivery(outbox, 'https://example.invalid', async (body) => {
    calls.push(body as { text: string });

    return { ok: true };
  });

  for (const alert of rateLimitAlerts([window(83, NOW + 3 * HOUR + 52 * 60_000)], NOW)) {
    await outbox.record(randomUUID(), 'limits', null, alert.kind, NOW, alert);
  }

  expect(await delivery.deliver(NOW)).toBe(0);
  // The reset waits for its time.
  expect(await delivery.deliver(NOW + HOUR)).toBe(0);
  expect(calls).toHaveLength(1);
  expect(await delivery.deliver(NOW + 4 * HOUR)).toBe(0);

  expect(calls.map((call) => call.text)).toEqual([
    'Claude: использовано 83% окна 5 ч. Сброс через 3 ч 52 мин.',
    'Claude: окно 5 ч сброшено, лимит снова доступен.',
  ]);
});
