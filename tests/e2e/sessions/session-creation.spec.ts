import { expect } from '@playwright/test';
import { test, deviceFixture, delivered, setCommandOutcome } from '../support/relay/relay-fixture.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { identity } from '../support/relay/identity.js';
import { SESSION_CREATE_IDS } from '@/features/create-session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';

for (const provider of ['claude', 'codex'] as const) {
  test(`creates a ${provider} session once and opens the authoritative new session`, async ({ page }) => {
    const { sockets, deviceId, relay } = deviceFixture();
    const snapshot = sessionSnapshot(deviceId);
    const source = snapshot.sessions[0]!;

    source.cwd = '/synthetic/project';
    source.capabilities.createSession = true;
    sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
    setCommandOutcome('held');
    await identity(page, '801', 'en');
    await page.goto('/');
    await page.getByTestId(SESSION_CREATE_IDS.toggle).click();

    if (provider === 'claude') {
      await page.getByTestId(SESSION_CREATE_IDS.provider.trigger).click();
      await page.getByTestId(SESSION_CREATE_IDS.claude).click();
    }

    await page.getByTestId(SESSION_CREATE_IDS.submit).click();
    await expect.poll(() => delivered.length).toBe(1);
    await expect(page.getByTestId(SESSION_CREATE_IDS.submit)).toBeDisabled();
    expect(delivered[0]?.action).toEqual({ type: 'create_session', provider, cwd: '/synthetic/project' });

    const created = {
      ...source,
      id: 'new-session',
      generation: 'new-generation',
      title: 'Fresh synthetic session',
      target:
        provider === 'codex'
          ? { kind: 'codex-cli' as const, deviceId, connectorId: 'new-codex', threadId: 'new-thread' }
          : {
              kind: 'claude-code-cli' as const,
              deviceId,
              connectorId: 'new-claude',
              claudeSessionId: 'new-source',
            },
      claudeSessionId: provider === 'codex' ? null : 'new-source',
    };

    snapshot.sessions.push(created);
    sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));

    sockets[0]!.send(
      JSON.stringify({
        type: 'command_result',
        result: { commandId: delivered[0]!.commandId, status: 'dispatched', sessionId: created.id },
      }),
    );

    await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toHaveText(created.title);

    const receipt = await relay.db.pool.query(
      'SELECT result_session_id FROM command_audit WHERE command_id=$1',
      [delivered[0]!.commandId],
    );

    expect(receipt.rows[0]?.result_session_id).toBe(created.id);
    expect(delivered).toHaveLength(1);
  });
}
