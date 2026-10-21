import { FrameType, RELAY_PROTOCOL, UsageProvider } from '@protocol';
import { expect, it } from 'vitest';
import { NotificationKind } from '@server/domain/notifications.js';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it("records one alert per threshold and window cycle from the device's snapshots", async () => {
  const f = await attachmentRelayFixture();

  try {
    const device = f.connect('/ws/device', f.deviceToken, { protocolVersion: RELAY_PROTOCOL.Current });

    await device.next(FrameType.Authenticated);

    const limits = [
      {
        provider: UsageProvider.Claude,
        windowMinutes: 300,
        usedPercent: 86,
        resetsAt: Date.now() + 3_600_000,
        observedAt: Date.now(),
      },
      {
        provider: UsageProvider.Claude,
        windowMinutes: 10_080,
        usedPercent: 40,
        resetsAt: Date.now() + 86_400_000,
        observedAt: Date.now(),
      },
    ];

    await f.publish(device, f.session);

    const snapshot = (
      await f.database.db.pool.query('SELECT snapshot FROM devices WHERE id=$1', [f.deviceId])
    ).rows[0].snapshot;

    for (let copy = 0; copy < 2; copy++) {
      device.send({
        type: FrameType.Snapshot,
        snapshot: { ...snapshot, rateLimits: limits },
        connectors: [],
      });
    }

    const kinds = async () =>
      (
        await f.database.db.pool.query(
          'SELECT kind FROM notification_outbox WHERE owner_id=$1 AND kind LIKE $2 ORDER BY kind',
          [f.principal.userId, 'rate_limit%'],
        )
      ).rows.map((row) => row.kind);

    await expect.poll(kinds).toEqual([NotificationKind.RateLimit, NotificationKind.RateLimitReset]);
  } finally {
    await f.close();
  }
});
