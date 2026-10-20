import { expect } from '@playwright/test';
import { test, deviceFixture } from '../support/relay/relay-fixture.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { identity } from '../support/relay/identity.js';
import { ACTIVITY_IDS } from '@/pages/session/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { byTestId } from '../support/ui/testid.js';

for (const [sessionId, kind] of [['terminal-session', 'command'], ['codex-cli-session', 'read']] as const) {
  test(`shows the current ${sessionId} step and removes the spinner on completion`, async ({ page }) => {
    const { sockets, deviceId } = deviceFixture();
    const snapshot = sessionSnapshot(deviceId);
    const session = snapshot.sessions.find((item) => item.id === sessionId)!;

    session.status = 'running';
    session.currentActivity = { id: 'synthetic-tool', kind, startedAt: Date.now() };
    snapshot.permissions = [];
    sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
    await identity(page, '801', 'en');
    await page.goto('/');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': sessionId }).click();
    await expect(page.getByTestId(ACTIVITY_IDS.label)).toHaveText(kind === 'command' ? 'Running a command…' : 'Reading files…');
    await expect(page.getByTestId(ACTIVITY_IDS.spinner)).toBeVisible();
    if(sessionId==='terminal-session')await page.screenshot({path:'artifacts/current-step-mobile.png'});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByTestId(ACTIVITY_IDS.spinner)).toHaveCSS('animation-name', 'none');
    session.status = 'waiting_permission';
    sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
    await expect(page.getByTestId(ACTIVITY_IDS.root)).toHaveCount(0);
    session.status = 'idle';
    delete session.currentActivity;
    sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
    await expect(page.getByTestId(ACTIVITY_IDS.root)).toHaveCount(0);
  });
}
