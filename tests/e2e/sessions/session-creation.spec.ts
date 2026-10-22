import { expect } from '@playwright/test';
import { test, deviceFixture, delivered, setCommandOutcome } from '../support/relay/relay-fixture.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
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

test("creates a Codex session on a model of the device's own sign-in, or on its default model", async ({ page }) => {
  const { sockets, deviceId } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);
  const source = snapshot.sessions[0]!;

  source.cwd = '/synthetic/project';
  source.capabilities.createSession = true;

  snapshot.models = [
    {
      provider: 'codex',
      models: [
        { id: 'synthetic-fast', efforts: [] },
        { id: 'synthetic-deep', efforts: ['low', 'high'] },
      ],
    },
  ];

  sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  setCommandOutcome('held');
  await identity(page, '801', 'en');
  await page.goto('/');
  await page.getByTestId(SESSION_CREATE_IDS.toggle).click();

  await expect(page.getByTestId(SESSION_CREATE_IDS.model.trigger)).toHaveText('Default model');
  await page.getByTestId(SESSION_CREATE_IDS.model.trigger).click();
  await byTestId(page, SESSION_CREATE_IDS.modelOption, { value: 'synthetic-deep' }).click();
  await page.getByTestId(SESSION_CREATE_IDS.effort.trigger).click();
  await byTestId(page, SESSION_CREATE_IDS.effortOption, { value: 'high' }).click();
  await page.getByTestId(SESSION_CREATE_IDS.submit).click();

  await expect.poll(() => delivered.length).toBe(1);

  expect(delivered[0]?.action).toEqual({
    type: 'create_session',
    provider: 'codex',
    cwd: '/synthetic/project',
    model: { model: 'synthetic-deep', effort: 'high' },
  });
});

test('continues a pasted session id in a new session', async ({ page }) => {
  const { sockets, deviceId } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);

  snapshot.sessions[0]!.cwd = '/synthetic/project';
  snapshot.sessions[0]!.capabilities.createSession = true;
  sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  setCommandOutcome('held');
  await identity(page, '801', 'en');
  await page.goto('/');
  await page.getByTestId(SESSION_CREATE_IDS.toggle).click();
  await page.getByTestId(SESSION_CREATE_IDS.resume).fill('  synthetic-thread-id  ');
  await page.getByTestId(SESSION_CREATE_IDS.submit).click();

  await expect.poll(() => delivered.length).toBe(1);

  expect(delivered[0]?.action).toEqual({
    type: 'create_session',
    provider: 'codex',
    cwd: '/synthetic/project',
    resume: 'synthetic-thread-id',
  });
});
