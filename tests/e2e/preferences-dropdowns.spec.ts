import { expect } from '@playwright/test';
import { test } from './support/relay-fixture.js';
import { identity } from './support/identity.js';
import { LANGUAGE_SWITCHER_IDS, THEME_SWITCHER_IDS } from '@/shared/ui/test-ids.js';

for (const language of ['ru', 'en'] as const) {
  test(`styled preference dropdowns support selected items and keyboard navigation in ${language}`, async ({
    page,
  }) => {
    await identity(page, '801', language);
    await page.goto('/');
    const theme = page.getByTestId(THEME_SWITCHER_IDS.trigger);

    await expect(theme).toHaveAttribute('aria-haspopup', 'menu');
    expect(await theme.evaluate((node) => node.tagName)).toBe('BUTTON');
    await theme.click();
    await expect(page.getByTestId(THEME_SWITCHER_IDS.auto)).toHaveAttribute('data-state', 'checked');
    await page.getByTestId(THEME_SWITCHER_IDS.dark).click();
    await expect(theme).toHaveAttribute('data-value', 'dark');
    await expect(page.getByTestId(THEME_SWITCHER_IDS.panel)).toBeHidden();
    await expect(theme).toBeFocused();
    const locale = page.getByTestId(LANGUAGE_SWITCHER_IDS.trigger);

    await locale.focus();
    await locale.press('ArrowDown');
    await expect(page.getByTestId(LANGUAGE_SWITCHER_IDS[language])).toHaveAttribute('data-state', 'checked');
    await page.getByTestId(LANGUAGE_SWITCHER_IDS.en).press('End');
    await page.getByTestId(LANGUAGE_SWITCHER_IDS.en).press('Enter');
    await expect(locale).toHaveAttribute('data-value', 'en');
    await locale.click();
    await page.getByTestId(LANGUAGE_SWITCHER_IDS.en).press('Escape');
    await expect(locale).toBeFocused();
    await expect(page.getByTestId(LANGUAGE_SWITCHER_IDS.panel)).toBeHidden();

    if (language === 'ru') {
      await locale.click();
      await page.getByTestId(LANGUAGE_SWITCHER_IDS.ru).click();
    }

    await locale.click();
    await expect(locale).toHaveCSS('border-color', 'rgb(0, 152, 255)');
    const selected = page.getByTestId(LANGUAGE_SWITCHER_IDS[language]);
    const fill = await selected.evaluate((node) => getComputedStyle(node).backgroundColor);

    expect(fill).toContain('color(srgb');
    const channels = fill.match(/[\d.]+/g)!.map(Number);

    expect(channels[2]).toBeGreaterThan(channels[0]!);
    expect(channels[2]).toBeGreaterThan(channels[1]!);

    await page.screenshot({
      path: `artifacts/language-cool-palette-${language}.png`,
      clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 260 },
      animations: 'disabled',
    });

    await locale.press('Escape');
    await theme.click();
    await page.screenshot({ path: `artifacts/preferences-dropdown-${language}.png`, animations: 'disabled' });
    await page.setViewportSize({ width: 320, height: 480 });
    await expect(page.getByTestId(THEME_SWITCHER_IDS.panel)).toBeInViewport({ ratio: 1 });
  });
}
