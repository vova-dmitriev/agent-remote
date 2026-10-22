import { expect } from '@playwright/test';
import { CommandActionType, FrameType, TerminalKey } from '@protocol';
import { test, delivered, deviceFixture } from '../support/relay/relay-fixture.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS, TERMINAL_INPUT_IDS } from '@/pages/session/config/test-ids.js';

test('the Terminal tab types a line into the session terminal and presses the keys a phone lacks', async ({ page }) => {
  const { sockets, deviceId, relay } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);

  snapshot.sessions[0]!.capabilities.terminalInput = true;
  sockets[0]!.send(JSON.stringify({ type: FrameType.Snapshot, snapshot, connectors: [] }));

  await expect
    .poll(async () => (await relay.db.pool.query("SELECT data->'capabilities'->>'terminalInput' AS flag FROM sessions WHERE id='terminal-session'")).rows[0]?.flag)
    .toBe('true');

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  // The chat keeps its composer; the Terminal tab gets the terminal's own input.
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeVisible();
  await page.getByTestId(SESSION_PAGE_IDS.terminal).click();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveCount(0);

  const text = page.getByTestId(TERMINAL_INPUT_IDS.text);

  await text.fill('git status');
  await text.press('Enter');
  await expect.poll(() => delivered.length).toBe(1);
  expect(delivered[0]!.action).toEqual({ type: CommandActionType.TerminalInput, text: 'git status', key: TerminalKey.Enter });
  await expect(text).toHaveValue('');

  // Every press is its own command, so a key pressed twice reaches the terminal twice.
  await byTestId(page, TERMINAL_INPUT_IDS.key, { key: TerminalKey.Up }).click();
  await byTestId(page, TERMINAL_INPUT_IDS.key, { key: TerminalKey.Up }).click();
  await byTestId(page, TERMINAL_INPUT_IDS.key, { key: TerminalKey.Interrupt }).click();
  await expect.poll(() => delivered.length).toBe(4);

  expect(delivered.slice(1).map((command) => command.action)).toEqual([
    { type: CommandActionType.TerminalInput, key: TerminalKey.Up },
    { type: CommandActionType.TerminalInput, key: TerminalKey.Up },
    { type: CommandActionType.TerminalInput, key: TerminalKey.Interrupt },
  ]);
});
