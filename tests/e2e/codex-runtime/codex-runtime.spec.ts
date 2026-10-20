import { expect } from '@playwright/test';
import { test } from './fixture.js';
import { identity } from '../support/relay/identity.js';
import { interruptSession } from '../support/ui/session-actions.js';
import { byTestId } from '../support/ui/testid.js';
import { verifySecurity, verifySourceError, verifyNotification } from './security.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import {
  SESSION_PAGE_IDS,
  SESSION_FEED_IDS,
  PERMISSION_IDS,
} from '@/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';
import { SHELL_IDS } from '@/widgets/application-shell/config/test-ids.js';

for (const kind of ['codex-cli', 'codex-desktop'] as const) {
  test.describe(kind + ' real daemon', () => {
    test.use({ kind });

    test('renders native history, streams once, resolves approvals, interrupts and reconnects', async ({
      page,
      runtime,
    }) => {
      test.setTimeout(60000);
      const { provider, current } = runtime;
      const original = current();

      await identity(page, '801', 'en');
      await page.goto('/');
      const card = byTestId(page, SESSION_CARD_IDS.root, { 'session-id': original.id });

      await expect(card.getByTestId(SESSION_CARD_IDS.title)).toHaveText(provider.model.title);
      await card.click();
      await expect(page.getByTestId(SESSION_PAGE_IDS.title)).toHaveText(provider.model.title);
      await expect(page.getByTestId(SESSION_FEED_IDS.content)).toContainText('Synthetic original question');
      await expect(page.getByTestId(SESSION_FEED_IDS.content)).toContainText('Synthetic original answer');

      await expect(page.getByTestId(SESSION_FEED_IDS.text)).toHaveText([
        'Synthetic original question',
        'Synthetic original answer',
      ]);

      await expect(page.getByTestId(SESSION_PAGE_IDS.terminal)).toHaveCount(0);
      await page.getByTestId(COMMAND_IDS.prompt).fill('Synthetic browser prompt');
      await page.getByTestId(COMMAND_IDS.send).click();
      await expect(page.getByTestId(SHELL_IDS.receipt)).toContainText('Delivered to session');

      expect(provider.model.starts).toEqual([
        { threadId: provider.model.threadId, input: [{ type: 'text', text: 'Synthetic browser prompt' }] },
      ]);

      await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Running');
      provider.model.stream('Synthetic streamed');
      await expect(page.getByTestId(SESSION_FEED_IDS.content)).toContainText('Synthetic streamed');
      provider.model.stream(' answer');
      await expect(page.getByTestId(SESSION_FEED_IDS.content)).toContainText('Synthetic streamed answer');
      await expect(page.getByTestId(SESSION_FEED_IDS.message)).toHaveCount(4);

      for (const [id, file, decision] of [
        ['command-allow', false, 'allow'],
        ['command-deny', false, 'deny'],
        ['file-allow', true, 'allow'],
        ['file-deny', true, 'deny'],
      ] as const) {
        provider.model.approval(id, file);

        await expect(page.getByTestId(PERMISSION_IDS.title)).toHaveText(
          file ? 'Allow Codex file change?' : 'Allow Codex command?',
        );

        await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Permission needed');
        await page.getByTestId(decision === 'allow' ? PERMISSION_IDS.allow : PERMISSION_IDS.deny).click();

        await expect
          .poll(() => provider.model.decisions.find((item) => item.id === id)?.decision)
          .toBe(decision === 'allow' ? 'accept' : 'decline');

        await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(0);
      }

      provider.model.approval('locally-resolved');
      await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(1);
      provider.model.resolve('locally-resolved');
      await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(0);
      await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Running');
      expect(provider.model.decisions).toHaveLength(4);
      const activeTurn = provider.model.active;

      await interruptSession(page);
      await expect.poll(() => provider.model.interrupts.length).toBe(1);

      expect(provider.model.interrupts[0]).toMatchObject(
        kind === 'codex-cli'
          ? { threadId: provider.model.threadId, turnId: activeTurn }
          : { conversationId: provider.model.threadId, expectedTurnId: activeTurn },
      );

      if (kind === 'codex-desktop') {
        for (const [method, version] of [
          ['thread-follower-start-turn', 2],
          ['thread-follower-interrupt-turn', 4],
          ['thread-follower-command-approval-decision', 1],
          ['thread-follower-file-approval-decision', 1],
        ] as const) {
          expect(provider.model.frames.find((frame) => frame.method === method)).toMatchObject({
            version,
            targetClientId: 'synthetic-owner',
          });
        }
      } else expect(provider.model.frames.find((frame) => frame.method === 'initialized')).toBeDefined();

      await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Ready for a message');
      await verifyNotification(runtime);
      await page.getByTestId(COMMAND_IDS.prompt).fill('Draft survives reconnect');
      provider.disconnect();
      await expect.poll(() => current().integrationState).toBe('disconnected');
      await expect(page.getByTestId(COMMAND_IDS.send)).toBeDisabled();
      await runtime.connect();
      await expect.poll(() => current().generation).not.toBe(original.generation);
      expect(current().id).toBe(original.id);
      await expect(page.getByTestId(COMMAND_IDS.prompt)).toHaveValue('Draft survives reconnect');
      await expect(page.getByTestId(SESSION_FEED_IDS.content)).toContainText('Synthetic original answer');
      await expect(page.getByTestId(SESSION_FEED_IDS.content)).toContainText('Synthetic streamed answer');
      await expect(page.getByTestId(SESSION_FEED_IDS.message)).toHaveCount(4);
      await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
      expect(provider.model.starts).toHaveLength(1);
      await page.getByTestId(COMMAND_IDS.send).click();
      await expect.poll(() => provider.model.starts.length).toBe(2);
      provider.model.approval('expires-with-turn', true);
      await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(1);
      const expired = runtime.daemon.monitor.snapshot().permissions[0]!;

      provider.model.finish();
      await expect(page.getByTestId(PERMISSION_IDS.root)).toHaveCount(0);
      await expect(page.getByTestId(SESSION_PAGE_IDS.status)).toHaveText('Ready for a message');

      await expect(
        runtime.relay.command(
          runtime.principal,
          runtime.command({
            type: 'permission',
            requestId: expired.requestId,
            decision: 'allow',
          }),
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_EXPIRED' });

      expect(provider.model.decisions).toHaveLength(4);
      await verifySourceError(page, runtime);
    });

    test('keeps ambiguous writes idempotent and rejects another owner and revoked access', async ({
      page,
      runtime,
    }) => {
      await verifySecurity(page, runtime);
    });
  });
}
