import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const origin = new URL(process.env.STORYBOOK_URL ?? 'http://localhost:6007');

if (!['localhost', '127.0.0.1'].includes(origin.hostname) || !['6006', '6007'].includes(origin.port)) {
  throw new Error('Use an isolated local Storybook on port 6006 or 6007.');
}

const captures = [
  {
    file: 'sessions.png',
    story: 'app-remote-application--sessions',
    width: 1100,
    height: 760,
    root: 'application-shell',
  },
  {
    file: 'conversation.png',
    story: 'app-remote-application--codex-session',
    width: 430,
    height: 600,
    root: 'application-shell',
  },
  {
    file: 'accounts.png',
    story: 'pages-accounts--accounts-and-keys',
    width: 700,
    height: 1000,
    root: 'accounts-page',
  },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  for (const capture of captures) {
    const context = await browser.newContext({
      viewport: { width: capture.width, height: capture.height },
      deviceScaleFactor: 2,
      locale: 'en-US',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });

    await context.route('**/*', async (route) => {
      const target = new URL(route.request().url());

      if (target.origin === origin.origin || target.origin === 'http://api.storybook.local') {
        await route.continue();
      } else {
        await route.abort('blockedbyclient');
      }
    });

    const page = await context.newPage();
    const url = new URL('/iframe.html', origin);

    url.searchParams.set('id', capture.story);
    url.searchParams.set('viewMode', 'story');
    url.searchParams.set('globals', 'language:en;theme:dark');
    await page.goto(url.href);
    await page.getByTestId(capture.root).waitFor({ state: 'visible', timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);

    const text = await page.locator('body').innerText();

    if (/[\u0400-\u04ff]/u.test(text)) {
      throw new Error(`Non-English text in ${capture.story}`);
    }

    await page.screenshot({
      path: fileURLToPath(new URL(capture.file, import.meta.url)),
      animations: 'disabled',
    });
    console.log(JSON.stringify({ ...capture, url: url.href, text }));
    await context.close();
  }
} finally {
  await browser.close();
}
