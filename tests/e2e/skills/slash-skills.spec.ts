import { expect } from '@playwright/test';
import { FrameType, Language, ThemePreference } from '@protocol';
import { test, deviceFixture, delivered, publishMessages } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SLASH_SKILL_IDS } from '@/features/send-command/config/slash-test-ids.js';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { conversation } from '../support/fixtures/conversation-fixtures.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';

for (const theme of [ThemePreference.Light, ThemePreference.Dark]) {
  test(`slash skills are opaque and usable above history in ${theme} theme`, async ({ page }) => {
  const { sockets, deviceId } = deviceFixture();
  let reads = 0;
  let pending: { requestId: string; sessionId: string; generation: string } | undefined;

  sockets[0]!.on('message', (raw) => {
    const frame = JSON.parse(String(raw));

    if (frame.type !== FrameType.SkillsRequest) return;
    reads++;
    pending = { requestId: frame.requestId, sessionId: frame.sessionId, generation: frame.generation };
  });

  sockets[0]!.send(JSON.stringify({ type: FrameType.Snapshot, snapshot: { ...sessionSnapshot(deviceId), permissions: [] }, connectors: [] }));
  await publishMessages(conversation);
  await identity(page, '801', Language.En);

  await page.route('**/preferences', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { language: Language.En, theme } })
    : route.continue());

  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  const input = page.getByTestId(COMMAND_IDS.prompt);

  await page.getByTestId(SESSION_FEED_IDS.marker).first().click();
  await expect.poll(() => page.getByTestId(SESSION_FEED_IDS.root).evaluate(node => node.scrollTop)).toBeLessThan(5);
  await page.mouse.move(0, 0);
  const bottom = page.getByTestId(SESSION_FEED_IDS.bottom);

  await expect(bottom).toBeVisible();

  await input.fill('/');
  await expect(page.getByTestId(SLASH_SKILL_IDS.status)).toBeVisible();
  const menu = page.getByTestId(SLASH_SKILL_IDS.menu);

  await expect(menu).toHaveCSS('background-color', /^rgb\(\d+, \d+, \d+\)$/u);
  expect((await menu.boundingBox())!.height).toBeLessThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath('skills-loading.png') });
  await input.press('Enter');
  await expect(input).toHaveValue('/');
  expect(delivered).toHaveLength(0);

  expect(pending).toBeDefined();

  sockets[0]!.send(JSON.stringify({
    type: FrameType.SkillsResult,
    requestId: pending!.requestId,
    reply: { ok: true, skills: {
      sessionId: pending!.sessionId, generation: pending!.generation, supported: true, truncated: false,
      skills: [
        { name: 'review', invocation: '/review', description: 'Review synthetic changes' },
        { name: 'test', invocation: '/test', description: 'Run synthetic checks' },
      ],
    } },
  }));

  await expect(page.getByTestId(SLASH_SKILL_IDS.option)).toHaveCount(2);
  const buttonBox = (await bottom.boundingBox())!;
  const menuBox = (await menu.boundingBox())!;
  const overlapTop = Math.max(buttonBox.y, menuBox.y);
  const overlapBottom = Math.min(buttonBox.y + buttonBox.height, menuBox.y + menuBox.height);

  expect(overlapBottom).toBeGreaterThan(overlapTop);

  expect(await menu.evaluate((node, point) => node.contains(document.elementFromPoint(point.x, point.y)), {
    x: buttonBox.x + buttonBox.width / 2, y: (overlapTop + overlapBottom) / 2,
  })).toBe(true);

  await page.screenshot({ path: test.info().outputPath('skills-ready.png') });
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('/test ');
  await expect(page.getByTestId(SLASH_SKILL_IDS.menu)).toHaveCount(0);
  expect(delivered).toHaveLength(0);
  await input.fill('/rev');
  await expect(page.getByTestId(SLASH_SKILL_IDS.option)).toHaveCount(1);
  await page.getByTestId(SLASH_SKILL_IDS.option).click();
  await expect(input).toHaveValue('/review ');
  expect(delivered).toHaveLength(0);
  await input.press('Enter');
  await expect.poll(() => delivered.length).toBe(1);
  expect(delivered[0]!.action).toEqual({ type: 'prompt', text: '/review ' });
  expect(reads).toBe(1);
});
}
