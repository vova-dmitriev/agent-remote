import { expect } from '@playwright/test';
import { SESSION_AVAILABILITY_IDS as IDS } from '../../apps/mini-app/src/entities/session/config/availability-test-ids.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';
import { SHELL_IDS } from '../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';
import { test, delivered } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { publishSnapshot } from './product/device.js';
import { chooseTheme } from './support/preferences.js';

for (const language of ['ru', 'en'] as const) {
  test(`session status is compact, opens on tap and reflects source availability in ${language}`, async ({
    page,
  }) => {
    await identity(page, '801', language);
    await page.setViewportSize({ width: 320, height: 400 });
    await page.goto('/');
    await chooseTheme(page, 'dark');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
    const trigger = page.getByTestId(IDS.trigger);
    const details = page.getByTestId(IDS.details);
    const online = language === 'ru' ? 'Сессия онлайн' : 'Session online';
    const offline = language === 'ru' ? 'Сессия недоступна' : 'Session unavailable';

    await expect(page.getByTestId(SHELL_IDS.home)).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-label', online);
    await expect(details).toHaveCount(0);
    await trigger.tap();
    await expect(details).toHaveText(online);
    const box = (await details.boundingBox())!;

    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await trigger.tap();
    await expect(details).toHaveCount(0);
    await trigger.tap();
    await page.getByTestId(SESSION_PAGE_IDS.title).tap();
    await expect(details).toHaveCount(0);
    await trigger.focus();
    await expect(details).toHaveText(online);
    await trigger.press('Escape');
    await expect(details).toHaveCount(0);
    await trigger.tap();

    await publishSnapshot((snapshot) => {
      snapshot.sessions.find((session) => session.id === 'chat-session')!.integrationState = 'disconnected';
    });

    await expect(trigger).toHaveAttribute('data-availability', 'offline');
    await expect(details).toHaveText(offline);
    await page.screenshot({ path: `artifacts/session-status-${language}-dark.png`, animations: 'disabled' });

    await publishSnapshot((snapshot) => {
      const session = snapshot.sessions.find((item) => item.id === 'chat-session')!;

      session.integrationState = 'ready';
      session.status = 'running';
    });

    await expect(trigger).toHaveAttribute('data-availability', 'online');
    expect(delivered).toHaveLength(0);
  });
}

test('mouse hover reveals status without locking it open', async ({ page }) => {
  await page.clock.install();
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'chat-session' }).click();
  const trigger = page.getByTestId(IDS.trigger);
  const details = page.getByTestId(IDS.details);

  await trigger.hover();
  await expect(details).toHaveText('Session online');
  await page.getByTestId(SESSION_PAGE_IDS.title).hover();
  await page.clock.runFor(200);
  await expect(details).toHaveCount(0);
  await trigger.focus();
  await expect(details).toHaveText('Session online');
  await trigger.hover();
  await page.getByTestId(SESSION_PAGE_IDS.title).hover();
  await page.clock.runFor(200);
  await expect(details).toHaveText('Session online');
  await trigger.press('Tab');
  await expect(details).toHaveCount(0);
});
