import { expect, type Locator, type Page } from '@playwright/test';
import { SESSION_FEED_IDS } from '@/pages/session/config/test-ids.js';
import { byTestIdListing } from './testid.js';

/** The rail hit target that covers a message; a merged target jumps to its first message. */
export function railMarker(page: Page, messageId: string) {
  return byTestIdListing(page, SESSION_FEED_IDS.marker, { 'message-ids': messageId });
}

/** Messages the rail maps, which is every loaded message. */
export async function expectLoadedMessages(page: Page, count: number) {
  await expect(page.getByTestId(SESSION_FEED_IDS.rail)).toHaveAttribute('data-message-count', String(count));
}

/**
 * Waits until the rail's markers keep the same groups and positions across two animation frames.
 * Markers regroup while rows are measured, so a marker read before this settles may no longer exist.
 */
export async function expectSettledRail(page: Page) {
  const markers = page.getByTestId(SESSION_FEED_IDS.marker);
  let previous = '';

  await expect
    .poll(async () => {
      const layout = await markers.evaluateAll(
        (nodes: HTMLElement[]) =>
          new Promise<string>((resolve) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(nodes.map((node) => node.dataset.messageIds + '@' + node.style.top).join('|'))),
            );
          }),
      );

      const settled = layout !== '' && layout === previous;

      previous = layout;

      return settled;
    })
    .toBe(true);
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

/** Synthetic messages of uneven length, so measuring rows moves later markers. */
export function railConversation(count: number, prefix = 'rail-') {
  return Array.from({ length: count }, (_, index) => ({
    id: prefix + index,
    role: index % 2 ? ('assistant' as const) : ('user' as const),
    text: 'Synthetic rail message ' + index + '. ' + 'Body text. '.repeat((index % 5) * 12 + 2),
    occurredAt: 1700000000000 + index,
  }));
}

export async function box(locator: Locator) {
  const bounds = await locator.boundingBox();

  expect(bounds).not.toBeNull();

  return bounds!;
}

/** The test id of the focused element, or null. */
export function focusedTestId(page: Page) {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
}
