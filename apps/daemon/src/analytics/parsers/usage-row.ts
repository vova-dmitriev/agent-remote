import { costUsd, priceFor, type PricedUsage, type UsageProvider } from '@protocol';

/** One API request's tokens, keyed so that reading the same transcript again replaces it instead of adding it. */
export interface UsageRequest extends PricedUsage {
  provider: UsageProvider;
  key: string;
  sessionId: string;
  project: string;
  model: string;
  at: number;
}

export interface UsageRow extends UsageRequest {
  /** The Mac's local calendar day of `at`, `YYYY-MM-DD`. */
  day: string;
  costUsd: number | null;
}

const pad = (value: number) => String(value).padStart(2, '0');

export const localDay = (at: number) => {
  const date = new Date(at);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export function usageRow(row: UsageRequest): UsageRow {
  const price = priceFor(row.model);

  return { ...row, day: localDay(row.at), costUsd: price ? costUsd(row, price) : null };
}

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;

export const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
