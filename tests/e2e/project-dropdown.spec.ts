import { expect } from '@playwright/test';
import { test, deviceFixture } from './support/relay-fixture.js';
import { sessionSnapshot } from './support/session-fixtures.js';
import { identity } from './support/identity.js';
import { SESSION_CREATE_IDS } from '../../apps/mini-app/src/features/create-session/config/test-ids.js';

for (const width of [320, 390]) {
  test(`long project paths wrap inside the ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const { sockets, deviceId } = deviceFixture();
    const snapshot = sessionSnapshot(deviceId);
    const path = '/private/var/folders/' + 'synthetic-long-directory-'.repeat(10) + '/project';

    snapshot.sessions[0]!.cwd = path;
    snapshot.sessions[0]!.capabilities.createSession = true;
    sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
    await identity(page, '801', 'en');
    await page.goto('/');
    await page.getByTestId(SESSION_CREATE_IDS.toggle).click();
    await page.getByTestId(SESSION_CREATE_IDS.project.trigger).click();
    const panel = page.getByTestId(SESSION_CREATE_IDS.project.panel);
    const item = page.getByTestId(SESSION_CREATE_IDS.projectOption);

    await expect(item).toBeVisible();
    expect(await item.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const bounds = await panel.boundingBox();

    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await item.click();
    await expect(panel).not.toBeVisible();

    await expect(page.getByTestId(SESSION_CREATE_IDS.project.trigger)).toHaveAttribute(
      'data-value',
      snapshot.sessions[0]!.id,
    );
  });
}
