import type { Page } from '@playwright/test';
export function byTestId(page: Page, id: string, attributes: Record<string, string>) {
  const selector = Object.entries(attributes)
    .map(([name, value]) => {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('INVALID_DATA_ATTRIBUTE');
      return `[data-${name}=${JSON.stringify(value)}]`;
    })
    .join('');
  return page.getByTestId(id).and(page.locator(selector));
}
