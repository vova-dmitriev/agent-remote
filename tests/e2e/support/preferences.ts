import type { Page } from '@playwright/test';
import { LANGUAGE_SWITCHER_IDS, THEME_SWITCHER_IDS } from '../../../apps/mini-app/src/shared/ui/test-ids.js';

export async function chooseLanguage(page: Page, value: 'ru' | 'en') {
  await page.getByTestId(LANGUAGE_SWITCHER_IDS.trigger).click();
  await page.getByTestId(LANGUAGE_SWITCHER_IDS[value]).click();
}

export async function chooseTheme(page: Page, value: 'auto' | 'light' | 'dark') {
  await page.getByTestId(THEME_SWITCHER_IDS.trigger).click();
  await page.getByTestId(THEME_SWITCHER_IDS[value]).click();
}
