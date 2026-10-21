import { expect } from '@playwright/test';
import { FrameType } from '@protocol';
import { test, deviceFixture, delivered } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SLASH_SKILL_IDS } from '@/features/send-command/config/slash-test-ids.js';

test('slash lists session skills, filters, supports keyboard and inserts without sending', async ({ page }) => {
  const { sockets } = deviceFixture();
  let reads = 0;
  let pending: { requestId: string; sessionId: string; generation: string } | undefined;

  sockets[0]!.on('message', (raw) => {
    const frame = JSON.parse(String(raw));

    if (frame.type !== FrameType.SkillsRequest) return;
    reads++;
    pending = { requestId: frame.requestId, sessionId: frame.sessionId, generation: frame.generation };
  });

  await identity(page, '801');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  const input = page.getByTestId(COMMAND_IDS.prompt);

  await input.fill('/');
  await expect(page.getByTestId(SLASH_SKILL_IDS.status)).toBeVisible();
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
