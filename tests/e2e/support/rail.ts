import { expect, type Page } from '@playwright/test';
import { SESSION_FEED_IDS } from '../../../apps/mini-app/src/pages/session/config/test-ids.js';
import { byTestIdListing } from './testid.js';

/** The rail hit target that covers a message; a merged target jumps to its first message. */
export function railMarker(page: Page, messageId: string) {
  return byTestIdListing(page, SESSION_FEED_IDS.marker, { 'message-ids': messageId });
}

/** Messages the rail maps, which is every loaded message. */
export async function expectLoadedMessages(page: Page, count: number) {
  await expect(page.getByTestId(SESSION_FEED_IDS.rail)).toHaveAttribute('data-message-count', String(count));
}

/** The message the rail marks as current; its marker may cover neighbours too. */
export async function expectActiveMessage(page: Page, messageId: string) {
  await expect(page.getByTestId(SESSION_FEED_IDS.rail)).toHaveAttribute('data-active-message-id', messageId);
}

/**
 * Jumps through the rail to the target that covers a message and returns the message the jump lands on.
 * Markers regroup while rows are measured, so the target is read and activated in one step.
 */
export async function jumpNear(page: Page, messageId: string) {
  return railMarker(page, messageId).evaluate((node: HTMLElement) => {
    node.click();

    return node.dataset.messageId!;
  });
}
