import { expect } from '@playwright/test';
import { test } from '../support/relay/relay-fixture.js';
import { publishSnapshot } from '../product/device.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { DEVICE_ACCESS_IDS } from '@/features/device-access/config/test-ids.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';
import type { ConnectorDescriptor } from '@protocol';

const desktop = (connectorId: string): ConnectorDescriptor => ({
  connectorId,
  kind: 'codex-desktop',
  state: 'ready',
  transport: 'app-server',
  sourceVersion: 'synthetic',
  reason: null,
  capabilities: {
    observe: true,
    history: true,
    prompt: true,
    interrupt: true,
    permission: true,
    terminalSnapshot: false,
  },
});

for (const language of ['ru', 'en'] as const) {
  test(`groups per-thread Codex connections without hiding sessions or failure details in ${language}`, async ({
    page,
  }) => {
    const connectors = [desktop('desktop-first'), desktop('desktop-second')];

    await publishSnapshot((snapshot) => {
      const original = snapshot.sessions.find((session) => session.target.kind === 'codex-desktop')!;

      snapshot.sessions.push({ ...original, id: 'second-desktop-session', title: 'Synthetic second thread' });
    }, connectors);

    await identity(page, '801', language);
    await page.goto('/');
    await expect(page.getByTestId(SHELL_IDS.home)).toHaveText('Agent Remote');
    await expect(page).toHaveTitle('Agent Remote');
    await page.getByTestId(DEVICE_ACCESS_IDS.toggle).click();
    const group = byTestId(page, DEVICE_ACCESS_IDS.connectorGroup, { 'source-kind': 'codex-desktop' });

    await expect(group).toHaveCount(1);
    await expect(group).toContainText(language === 'ru' ? 'Подключений: 2' : 'Connections: 2');
    await expect(group.getByTestId(DEVICE_ACCESS_IDS.connectorState)).toHaveCount(1);

    await expect(
      byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'codex-desktop-session' }),
    ).toBeVisible();

    await expect(
      byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'second-desktop-session' }),
    ).toBeVisible();

    await publishSnapshot(() => {}, [
      ...connectors,
      { ...desktop('desktop-offline'), state: 'disconnected', reason: 'CODEX_DISCONNECTED' },
      { ...desktop('terminal'), kind: 'codex-cli' },
    ]);

    await expect(group).toHaveCount(1);
    await expect(group.getByTestId(DEVICE_ACCESS_IDS.connectorState)).toHaveCount(2);
    await expect(group).toContainText(language === 'ru' ? 'Подключений: 3' : 'Connections: 3');

    await expect(group).toContainText(
      language === 'ru' ? 'Источник недоступен.' : 'The source is unavailable.',
    );

    await expect(
      byTestId(page, DEVICE_ACCESS_IDS.connectorGroup, { 'source-kind': 'codex-cli' }),
    ).toHaveCount(1);

    await page.screenshot({ path: `artifacts/connector-groups-${language}.png`, fullPage: true });
  });
}
