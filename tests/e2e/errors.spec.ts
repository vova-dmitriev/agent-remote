import { chooseLanguage } from './support/preferences.js';
import { expect } from '@playwright/test';
import type { ServerFrame } from '@protocol';
import { COMMAND_IDS } from '../../apps/mini-app/src/features/send-command/config/test-ids.js';
import { DEVICE_ACCESS_IDS } from '../../apps/mini-app/src/features/device-access/config/test-ids.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';
import { SHELL_IDS } from '../../apps/mini-app/src/widgets/application-shell/config/test-ids.js';
import { en } from '../../apps/mini-app/src/shared/lib/i18n/dictionaries/en.js';
import { ru } from '../../apps/mini-app/src/shared/lib/i18n/dictionaries/ru.js';
import { identity } from './support/identity.js';
import { test } from './support/relay-fixture.js';
import { byTestId } from './support/testid.js';
import { setSessionLanguage } from './support/session-language.js';
import { SESSION_PAGE_IDS } from '../../apps/mini-app/src/pages/session/config/test-ids.js';

test('authentication errors explain recovery in both languages', async ({ page }) => {
  await identity(page, '801');

  await page.route('**/devices', (route) =>
    route.fulfill({ status: 401, json: { code: 'NO_AUTHENTICATED_CLIENT' } }),
  );

  await page.goto('/');
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(ru.authFailed);
  await chooseLanguage(page, 'en');
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(en.authFailed);
  await expect(page.getByTestId(COMMAND_IDS.notice)).not.toContainText('NO_AUTHENTICATED_CLIENT');
});

for (const code of [
  'SYNTHETIC_UNKNOWN_ERROR',
  'Server failed at /synthetic/private.log token=synthetic-secret',
]) {
  test(`device query hides untrusted error: ${code.split(' ')[0]}`, async ({ page }) => {
    await identity(page, '801', 'en');
    await page.route('**/devices', (route) => route.fulfill({ status: 400, json: { code } }));
    await page.goto('/');
    await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(en.requestFailed);
    await chooseLanguage(page, 'ru');
    await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(ru.requestFailed);
  });
}

test('queued failures translate while retaining the selected session, original message and login', async ({
  page,
}) => {
  await identity(page, '801');
  let logins = 0;
  let accepted = false;

  page.on('request', (request) => {
    if (request.url().endsWith('/auth/telegram')) logins++;
  });

  await page.route('**/commands', (route) => {
    const command = route.request().postDataJSON() as { commandId: string };

    return route.fulfill(
      accepted
        ? { json: { commandId: command.commandId, status: 'rejected', code: 'STALE_SESSION' } }
        : { status: 400, json: { code: 'SYNTHETIC_COMMAND_ERROR' } },
    );
  });

  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic preserved draft');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(COMMAND_IDS.queuedError)).toHaveText(ru.requestFailed);
  await setSessionLanguage(page, 'en', 'terminal-session');
  await expect(page.getByTestId(COMMAND_IDS.queuedError)).toHaveText(en.requestFailed);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('');
  await expect(page.getByTestId(COMMAND_IDS.queuedText)).toHaveText('Synthetic preserved draft');
  accepted = true;
  await page.getByTestId(COMMAND_IDS.cancelQueued).click();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic preserved draft');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(COMMAND_IDS.queuedError)).toHaveText(en.sessionChanged);
  await expect(page.getByTestId(SHELL_IDS.receipt)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveCount(0);
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await chooseLanguage(page, 'ru');
  await expect(page.getByTestId(SHELL_IDS.receipt)).toHaveCount(0);
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'terminal-session' }).click();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('');
  await expect(page.getByTestId(COMMAND_IDS.queuedText)).toHaveText('Synthetic preserved draft');
  await expect(page.getByTestId(COMMAND_IDS.queuedError)).toHaveText(ru.sessionChanged);
  expect(logins).toBe(1);
});

test('server frame errors and connector reasons pass through the same safe translation boundary', async ({
  page,
}) => {
  await identity(page, '801', 'en');

  let inject: (frame: ServerFrame) => void = () => {
    throw new Error('SYNTHETIC_SOCKET_NOT_READY');
  };

  await page.routeWebSocket('**/ws/app', (socket) => {
    const server = socket.connectToServer();

    inject = (frame) => socket.send(JSON.stringify(frame));
    socket.onMessage((message) => server.send(message));

    server.onMessage((message) => {
      const frame = JSON.parse(String(message)) as ServerFrame;

      if (frame.type === 'snapshot') {
        frame.connectors = [
          {
            connectorId: 'synthetic-error-connector',
            kind: 'claude-code-cli',
            transport: 'pty',
            sourceVersion: 'synthetic',
            capabilities: frame.snapshot.sessions[0]!.capabilities,
            state: 'needs_setup',
            reason: 'AX_CHAT_OR_COMPOSER_UNVERIFIED',
          },
        ];
      }

      socket.send(JSON.stringify(frame));
    });
  });

  await page.goto('/');
  await expect(page.getByTestId(SESSION_CARD_IDS.root)).toHaveCount(4);
  await page.getByTestId(DEVICE_ACCESS_IDS.toggle).click();
  await expect(page.getByTestId(DEVICE_ACCESS_IDS.root)).toContainText(en.setupRequired);
  inject({ type: 'error', code: 'NO_AUTHENTICATED_CLIENT' });
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(en.authFailed);
  await chooseLanguage(page, 'ru');
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(ru.authFailed);
  await expect(page.getByTestId(DEVICE_ACCESS_IDS.root)).toContainText(ru.setupRequired);
  inject({ type: 'error', code: '/synthetic/private.log token=synthetic-secret' });
  await expect(page.getByTestId(COMMAND_IDS.notice)).toHaveText(ru.requestFailed);
});
