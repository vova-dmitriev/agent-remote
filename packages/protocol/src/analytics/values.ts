export const AnalyticsPeriod = {
  Today: 'today',
  Week: 'week',
  Month: 'month',
  All: 'all',
} as const;

export type AnalyticsPeriod = (typeof AnalyticsPeriod)[keyof typeof AnalyticsPeriod];

export const UsageProvider = {
  Claude: 'claude',
  Codex: 'codex',
} as const;

export type UsageProvider = (typeof UsageProvider)[keyof typeof UsageProvider];

/** The key and label of usage whose model or folder the transcript did not name. */
export const UNKNOWN_USAGE_KEY = 'unknown';
