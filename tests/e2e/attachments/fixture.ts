import { syntheticImageBytes } from '@storybook-fixtures/attachment/media.js';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { deviceFixture } from '../support/relay-fixture.js';
import { sessionSnapshot } from '../support/session-fixtures.js';
import { identity } from '../support/identity.js';
import { byTestId } from '../support/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';

export const png = Buffer.from(syntheticImageBytes());
export const image = { name: 'synthetic.png', mimeType: 'image/png', buffer: png };
export const file = {
  name: 'synthetic.json',
  mimeType: 'application/json',
  buffer: Buffer.from('{"synthetic":true}\n'),
};

export async function openAttachments(page: Page) {
  const { sockets, deviceId, relay } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);

  snapshot.sessions[0]!.capabilities.attachments = { images: 'reference', files: 'reference' };
  snapshot.sessions[2]!.capabilities.attachments = { images: 'native', files: 'reference' };
  sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));

  await expect
    .poll(async () => {
      const row = await relay.db.pool.query(
        "SELECT data->'capabilities'->'attachments' AS caps FROM sessions WHERE id='terminal-session'",
      );

      return row.rows[0]?.caps?.images;
    })
    .toBe('reference');

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
}
