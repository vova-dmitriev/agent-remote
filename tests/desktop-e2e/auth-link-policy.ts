import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { expect } from 'vitest';

export async function verifyDesktopAuthLinkPolicy(page: Page, externalLog: string): Promise<void> {
  await page.evaluate(() => {
    const addLink = (id: string, href: string) => {
      const anchor = document.createElement('a');

      anchor.id = id;
      anchor.href = href;
      anchor.target = '_blank';
      anchor.textContent = id;

      anchor.addEventListener('click', (event) => {
        anchor.dataset.trusted = String(event.isTrusted);
      });

      document.body.append(anchor);
    };

    addLink('auth-valid', 'https://auth.openai.com/authorize?state=ok');
    addLink('auth-deceptive', 'https://auth.openai.com.evil.test/authorize?state=bad');
    addLink('auth-file', 'file:///tmp/untrusted.html');

    const frame = document.createElement('iframe');

    frame.id = 'auth-subframe';
    document.body.append(frame);

    const frameAnchor = frame.contentDocument!.createElement('a');

    frameAnchor.id = 'subframe-auth';
    frameAnchor.href = 'https://auth.openai.com/authorize?state=subframe';
    frameAnchor.target = '_blank';
    frameAnchor.textContent = 'subframe auth';
    frame.contentDocument!.body.append(frameAnchor);
  });

  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('#auth-valid')?.click());
  expect(await readFile(externalLog, 'utf8').catch(() => '')).toBe('');

  await page.locator('#auth-valid').click();
  expect(await page.locator('#auth-valid').getAttribute('data-trusted')).toBe('true');

  await expect
    .poll(() => readFile(externalLog, 'utf8').catch(() => ''))
    .toEqual('https://auth.openai.com/authorize?state=ok\n');

  await page.locator('#auth-deceptive').click();
  await page.locator('#auth-file').click();
  await page.frameLocator('#auth-subframe').locator('#subframe-auth').click();
  expect(await readFile(externalLog, 'utf8')).toBe('https://auth.openai.com/authorize?state=ok\n');

  expect(
    await page.evaluate(() => ({
      bridgeKeys: Object.keys(window.desktopBridge ?? {}).sort(),
      hasGenericIpc: Object.prototype.hasOwnProperty.call(window, 'ipcRenderer'),
    })),
  ).toEqual({
    bridgeKeys: ['close', 'open', 'request', 'subscribe'],
    hasGenericIpc: false,
  });
}
