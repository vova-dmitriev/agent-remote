import { expect, type Page } from '@playwright/test';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { initData } from '../../helpers/relay/telegram.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { setSessionLanguage } from '../support/ui/session-language.js';
import type { Runtime } from './runtime.js';
import { relayOrigin } from '../runtime/app-origin.js';

export async function verifyNotification(runtime: Runtime) {
  const { relay, principal } = runtime;

  await relay.db.pool.query('UPDATE users SET private_chat_id=$1 WHERE id=$2', ['801', principal.userId]);
  let id: string | undefined;

  await expect
    .poll(async () => {
      id = (
        await relay.db.pool.query<{ id: string }>(
          "SELECT id FROM notification_outbox WHERE owner_id=$1 AND session_id=$2 AND kind='turn_end' ORDER BY created_at DESC LIMIT 1",
          [principal.userId, runtime.current().id],
        )
      ).rows[0]?.id;

      return !!id;
    })
    .toBe(true);

  const sent = (await relay.notifications.deliver('https://example.invalid', id!)) as Array<{
    chat_id: string;
    text: string;
    reply_markup: unknown;
  }>;

  expect(sent).toHaveLength(1);
  expect(sent[0]!.chat_id).toBe('801');
  expect(sent[0]!.text).toContain(runtime.provider.model.title);
  expect(sent[0]!.text).toContain('Synthetic streamed answer');
  expect(sent[0]!.text).not.toContain('Агент завершил ход');
  expect(JSON.stringify(sent[0]!.reply_markup)).toContain(encodeURIComponent(runtime.current().id));
}

export async function verifySecurity(page: Page, runtime: Runtime) {
  const { provider, relay, principal } = runtime;

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': runtime.current().id }).click();
  const otherLogin = await relay.auth.login(initData('802'));
  const other = await relay.auth.authenticate(otherLogin.token);
  const forbidden = runtime.command({ type: 'prompt', text: 'Must never reach Codex' });

  await expect(relay.command(other, forbidden)).rejects.toMatchObject({ code: 'NOT_FOUND' });

  await expect(relay.devices.owned(other, runtime.device.deviceId)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });

  expect(provider.model.starts).toHaveLength(0);

  await page.route('**/commands', async (route) => {
    await route.fetch();
    await route.abort('failed');
  });

  await page.route('**/commands/*', (route) => route.abort('failed'));
  provider.model.ambiguousNext = true;
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic ambiguous prompt');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeVisible();
  await expect.poll(async () => (await runtime.audit())[0]?.status).toBe('unknown');
  expect(provider.model.starts).toHaveLength(1);
  const audit = (await runtime.audit())[0]!;
  const duplicate = runtime.command({ type: 'prompt', text: 'Synthetic ambiguous prompt' }, audit.command_id);

  await page.unroute('**/commands');
  await page.unroute('**/commands/*');
  await page.getByTestId(COMMAND_IDS.retryQueued).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeEnabled();
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('');
  await expect(page.getByTestId(COMMAND_IDS.queuedText)).toHaveText('Synthetic ambiguous prompt');
  await page.getByTestId(COMMAND_IDS.retryQueued).click();
  await expect(page.getByTestId(COMMAND_IDS.retryQueued)).toBeEnabled();

  await expect(page.getByTestId(SHELL_IDS.receipt)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.queuedStatus)).toHaveText('Delivery unconfirmed · queue paused');

  await expect(relay.command(principal, duplicate)).resolves.toMatchObject({ status: 'unknown' });
  expect(provider.model.starts).toHaveLength(1);
  expect(await runtime.audit()).toHaveLength(1);

  const revoke = await page.request.delete(`${relayOrigin}/devices/` + runtime.device.deviceId, {
    headers: { Authorization: 'Bearer ' + runtime.login.token },
  });

  expect(revoke.ok()).toBe(true);
  await expect.poll(() => relay.live.has(runtime.device.deviceId)).toBe(false);
  await expect(relay.command(principal, duplicate)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(provider.model.starts).toHaveLength(1);
}

export async function verifySourceError(page: Page, runtime: Runtime) {
  const { provider } = runtime;
  const privateMarker = 'SYNTHETIC_PRIVATE_DIAGNOSTIC';

  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic failed turn');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => provider.model.starts.length).toBe(3);
  await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Running');
  provider.model.finish({ message: 'model synthetic-model is not available; ' + privateMarker });

  await expect(page.getByTestId(SESSION_PAGE_IDS.sourceError)).toHaveText(
    'This model is unavailable for the current Codex sign-in. Choose a model on your Mac.',
  );

  expect(runtime.current().errorCode).toBe('CODEX_MODEL_UNAVAILABLE');
  expect(JSON.stringify(runtime.daemon.monitor.snapshot())).not.toContain(privateMarker);
  const history = await runtime.relay.db.pool.query('SELECT data FROM events');

  expect(JSON.stringify(history.rows)).not.toContain(privateMarker);
  await setSessionLanguage(page, 'ru', runtime.current().id);
  await expect(page.getByTestId(SESSION_PAGE_IDS.sourceError)).toContainText('Эта модель недоступна');
  await setSessionLanguage(page, 'en', runtime.current().id);
  await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic recovery turn');
  await page.getByTestId(COMMAND_IDS.send).click();
  await expect.poll(() => provider.model.starts.length).toBe(4);
  await expect(page.getByTestId(SESSION_PAGE_IDS.sourceError)).toHaveCount(0);
  expect(runtime.current().errorCode).toBeUndefined();
  provider.model.finish();
}
