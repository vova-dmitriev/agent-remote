import type { Page } from '@playwright/test';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';

export async function interruptSession(page: Page) {
  await page.getByTestId(COMMAND_IDS.actionsTrigger).click();
  await page.getByTestId(COMMAND_IDS.interrupt).click();
}
