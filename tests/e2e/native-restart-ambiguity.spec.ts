import { expect } from '@playwright/test';
import { test, deviceFixture, delivered } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { byTestId } from './support/testid.js';
import { sessionSnapshot } from './support/session-fixtures.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';

for (const language of ['en', 'ru'] as const) {
  test(`explains duplicate native writers and enables restart only after a unique source remains in ${language}`, async ({ page }) => {
    const f = deviceFixture();
    const snapshot = sessionSnapshot(f.deviceId);
    const source = snapshot.sessions[0]!;

    source.target = {
      kind: 'claude-code-cli',
      deviceId: f.deviceId,
      connectorId: 'native',
      claudeSessionId: source.claudeSessionId!,
    };

    source.binding = 'unverified';
    source.integrationState = 'needs_restart';
    source.nativeRestartState = 'missing';
    source.capabilities = { ...source.capabilities, prompt: false, restartSession: false };
    snapshot.permissions = [];
    snapshot.terminal = null;
    f.sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
    await identity(page, '801', language);
    await page.goto('/');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
    await expect(page.getByTestId(COMMAND_IDS.restartSession)).toHaveCount(0);

    source.nativeRestartState = 'ambiguous';
    f.sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));

    await expect(page.getByTestId(COMMAND_IDS.connectionHint)).toContainText(
      language === 'en' ? 'multiple Claude processes' : 'нескольких процессах Claude',
    );

    await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeDisabled();
    await expect(page.getByTestId(COMMAND_IDS.restartSession)).toHaveCount(0);
    expect(delivered).toHaveLength(0);

    source.nativeRestartState = 'available';
    source.capabilities.restartSession = true;
    f.sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
    await expect(page.getByTestId(COMMAND_IDS.restartSession)).toBeEnabled();
    await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeDisabled();
    expect(delivered).toHaveLength(0);
  });
}
