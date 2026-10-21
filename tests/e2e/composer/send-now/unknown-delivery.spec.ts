import { expect } from '@playwright/test';
import { CommandStatus, FrameType, PromptDelivery, SessionStatus, TargetKind } from '@protocol';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { test, delivered, deviceFixture, setCommandOutcome } from '../../support/relay/relay-fixture.js';
import { sessionSnapshot } from '../../support/fixtures/session-fixtures.js';
import { identity } from '../../support/relay/identity.js';
import { byTestId } from '../../support/ui/testid.js';

for (const kind of [TargetKind.CodexCli, TargetKind.CodexDesktop]) {
  test(`${kind} sends a distinct queued instruction now while preserving the previous unknown receipt`, async ({ page }) => {
    const sessionId = `${kind}-session`;

    await identity(page, '801', 'en');
    await page.goto('/');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': sessionId }).click();
    setCommandOutcome(CommandStatus.Unknown);
    await page.getByTestId(COMMAND_IDS.prompt).fill('First synthetic instruction');
    await page.getByTestId(COMMAND_IDS.prompt).press('Enter');
    await expect(page.getByTestId(COMMAND_IDS.checkQueued)).toBeVisible();
    expect(delivered).toHaveLength(1);
    const previousId = delivered[0]!.commandId;
    const { sockets, deviceId } = deviceFixture();
    const snapshot = sessionSnapshot(deviceId);

    snapshot.sessions.find((session) => session.id === sessionId)!.status = SessionStatus.Running;
    sockets[0]!.send(JSON.stringify({ type: FrameType.Snapshot, snapshot, connectors: [] }));
    await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Running');
    await page.getByTestId(COMMAND_IDS.prompt).fill('A distinct synthetic instruction');
    await page.getByTestId(COMMAND_IDS.prompt).press('Enter');
    await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveCount(2);
    const sendNow = page.getByTestId(COMMAND_IDS.sendQueuedNow);

    await expect(sendNow).toHaveCount(1);
    await expect(sendNow).toBeEnabled();
    setCommandOutcome(CommandStatus.Dispatched);
    await sendNow.click();
    await expect.poll(() => delivered.length).toBe(2);
    expect(delivered[1]!.commandId).not.toBe(previousId);
    expect(delivered[1]!.action).toMatchObject({ text: 'A distinct synthetic instruction', delivery: PromptDelivery.Immediate });
    expect(delivered.filter((command) => command.commandId === previousId)).toHaveLength(1);
    await expect(page.getByTestId(COMMAND_IDS.queuedItem)).toHaveCount(1);
    await expect(page.getByTestId(COMMAND_IDS.checkQueued)).toBeVisible();
  });
}
