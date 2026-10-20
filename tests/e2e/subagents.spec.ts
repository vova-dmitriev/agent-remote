import { expect } from '@playwright/test';
import { test, deviceFixture } from './support/relay-fixture.js';
import { sessionSnapshot } from './support/session-fixtures.js';
import { identity } from './support/identity.js';
import { SUBAGENT_IDS } from '@/pages/session/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { byTestId } from './support/testid.js';

test('shows child work and live completion without changing the parent conversation', async ({ page }) => {
  const { sockets, deviceId } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);

  snapshot.sessions[0]!.subagents = [{ id: 'child', name: 'Reviewer', task: 'Review synthetic parser', model: 'synthetic-model', status: 'running', updatedAt: 1 }];
  sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(SUBAGENT_IDS.toggle).click();
  await expect(page.getByTestId(SUBAGENT_IDS.task)).toHaveText('Review synthetic parser');
  await expect(page.getByTestId(SUBAGENT_IDS.status)).toHaveText('Running');
  snapshot.sessions[0]!.subagents[0]!.status = 'completed';
  sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
  await expect(page.getByTestId(SUBAGENT_IDS.status)).toHaveText('Completed');
});
