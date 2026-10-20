import { expect } from '@playwright/test';
import { test, deviceFixture } from '../support/relay/relay-fixture.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { identity } from '../support/relay/identity.js';
import { byTestId } from '../support/ui/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_CHANGES_IDS as IDS } from '@/entities/session/config/change-test-ids.js';

for (const language of ['en', 'ru'] as const) {
  test(`owned native file patches expand safely on mobile in ${language}`, async ({ page }) => {
    const { sockets, deviceId } = deviceFixture();
    const snapshot = sessionSnapshot(deviceId);
    const session = snapshot.sessions.find((value) => value.id === 'codex-cli-session')!;

    session.changes = {
      truncated: true,
      files: [
        {
          id: 'synthetic-edit:src/example.ts',
          path: 'src/example.ts',
          kind: 'update',
          truncated: false,
          patch:
            '@@ -1 +1 @@\n-export const value = 1;\n+export const value: number = 2;\n+// <script>synthetic()</script>',
        },
      ],
    };

    sockets[0]!.send(JSON.stringify({ type: 'snapshot', snapshot, connectors: [] }));
    await page.setViewportSize({ width: 390, height: 844 });
    await identity(page, '801', language);
    await page.goto('/');
    await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': 'codex-cli-session' }).click();
    await expect(page.getByTestId(IDS.toggle)).toContainText(language === 'en' ? 'Changes' : 'Изменения');
    await page.getByTestId(IDS.toggle).click();
    await expect(page.getByTestId(IDS.fileToggle)).toContainText('src/example.ts');
    await page.getByTestId(IDS.fileToggle).click();
    const patch = page.getByTestId(IDS.patch);

    await expect(patch).toContainText('+export const value: number = 2;');
    await expect(patch).toContainText('<script>synthetic()</script>');
    const markup = await patch.evaluate((element) => element.innerHTML);

    expect(markup).toContain('hljs-keyword');
    expect(markup).toContain('data-diff-line="add"');
    expect(markup).toContain('data-diff-line="delete"');
    expect(markup).not.toContain('<script>');

    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(
      1,
    );

    await page.screenshot({ path: `artifacts/session-changes-${language}.png` });
  });
}
