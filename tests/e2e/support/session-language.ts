import { chooseLanguage } from './preferences.js';
import type { Page } from '@playwright/test';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { SESSION_PAGE_IDS } from '@/pages/session/config/test-ids.js';
import { byTestId } from './testid.js';

export async function setSessionLanguage(
  page: Page,
  language: 'ru' | 'en',
  sessionId: string,
  tab: 'history' | 'terminal' = 'history',
) {
  await page.getByTestId(SESSION_PAGE_IDS.back).click();
  await chooseLanguage(page, language);
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': sessionId }).click();
  if (tab === 'terminal') await page.getByTestId(SESSION_PAGE_IDS.terminal).click();
}
