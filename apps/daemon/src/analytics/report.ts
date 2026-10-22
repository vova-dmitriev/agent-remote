import { basename } from 'node:path';
import {
  AnalyticsPeriod,
  UNKNOWN_USAGE_KEY,
  type AnalyticsQuery,
  type AnalyticsReport,
  type SessionUsage,
  type UsageProvider,
} from '@protocol';
import type { UsageStore } from './store.js';

const PERIOD_DAYS = {
  [AnalyticsPeriod.Today]: 0,
  [AnalyticsPeriod.Week]: 6,
  [AnalyticsPeriod.Month]: 29,
} as const;

const SUMS = `sum(input) AS input, sum(output) AS output, sum(cache_read) AS cache_read,
  sum(cache_write + cache_write_long) AS cache_write, sum(cost) AS cost`;

const ORDER =
  'cost DESC NULLS LAST, sum(input + output + cache_read + cache_write + cache_write_long) DESC, key';

type Row = Record<string, unknown>;

/** The first moment of a period in the Mac's local time: today starts at local midnight. */
export function periodStart(period: AnalyticsPeriod, now = Date.now()) {
  if (period === AnalyticsPeriod.All) {
    return 0;
  }

  const start = new Date(now);

  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - PERIOD_DAYS[period]);

  return start.getTime();
}

const tokens = (row: Row) => ({
  input: Number(row.input ?? 0),
  output: Number(row.output ?? 0),
  cacheRead: Number(row.cache_read ?? 0),
  cacheWrite: Number(row.cache_write ?? 0),
});

const cost = (row: Row) => (row.cost === null || row.cost === undefined ? null : Number(row.cost));

const usage = (row: Row, label: (key: string) => string) => {
  const key = String(row.key ?? '') || UNKNOWN_USAGE_KEY;

  return {
    key,
    label: key === UNKNOWN_USAGE_KEY ? key : label(key),
    tokens: tokens(row),
    costUsd: cost(row),
  };
};

const folder = (path: string) => basename(path) || path;

export function usageReport(
  store: UsageStore,
  period: AnalyticsPeriod,
  importing: AnalyticsReport['importing'],
  rateLimits: AnalyticsReport['rateLimits'],
  now = Date.now(),
  filter: Omit<AnalyticsQuery, 'period'> = {},
): AnalyticsReport {
  // The days keep the whole period so another day can be picked; everything else narrows to the picked day too.
  const sessionWhere = `at_ms >= ?${filter.session === undefined ? '' : ' AND session_id = ?'}`;
  const sessionArgs = [periodStart(period, now), ...(filter.session === undefined ? [] : [filter.session])];
  const where = sessionWhere + (filter.day === undefined ? '' : ' AND day = ?');
  const since = [...sessionArgs, ...(filter.day === undefined ? [] : [filter.day])];

  const grouped = (column: string, limit: number) =>
    store.query(
      `SELECT ${column} AS key, ${SUMS} FROM usage WHERE ${where} GROUP BY ${column} ORDER BY ${ORDER} LIMIT ${limit}`,
      since,
    );

  const [totals] = store.query(`SELECT ${SUMS} FROM usage WHERE ${where}`, since);

  const sessions = store.query(
    `SELECT session_id AS key, max(provider) AS provider, max(project) AS project, max(at_ms) AS last_at,
       ${SUMS} FROM usage WHERE ${where} GROUP BY session_id ORDER BY last_at DESC LIMIT 100`,
    since,
  );

  const days = store.query(
    `SELECT day, ${SUMS} FROM usage WHERE ${sessionWhere} GROUP BY day ORDER BY day DESC LIMIT 400`,
    sessionArgs,
  );

  return {
    period,
    importing,
    totals: { tokens: tokens(totals ?? {}), costUsd: cost(totals ?? {}) },
    byModel: grouped('model', 50).map((row) => usage(row, (key) => key)),
    byProject: grouped('project', 50).map((row) => usage(row, folder)),
    bySession: sessions.map((row) => ({
      ...usage(row, () => folder(String(row.project ?? '')) || UNKNOWN_USAGE_KEY),
      provider: row.provider as UsageProvider,
      lastAt: Number(row.last_at),
    })),
    daily: days.reverse().map((row) => ({ day: String(row.day), tokens: tokens(row), costUsd: cost(row) })),
    rateLimits,
  };
}

/** The session and day a request narrows its report to, without the keys it left out. */
export const analyticsFilter = ({ session, day }: Omit<AnalyticsQuery, 'period'>) => ({
  ...(session === undefined ? {} : { session }),
  ...(day === undefined ? {} : { day }),
});

/** All-time usage of the sessions the app shows, with the context each last reported. */
export function sessionUsages(
  store: UsageStore,
  ids: readonly string[],
  contexts: ReadonlyMap<string, NonNullable<SessionUsage['context']>>,
) {
  const usages = new Map<string, SessionUsage>();

  if (!ids.length) {
    return usages;
  }

  const rows = store.query(
    `SELECT session_id AS key, ${SUMS} FROM usage WHERE session_id IN (${ids.map(() => '?').join(', ')})
     GROUP BY session_id`,
    [...ids],
  );

  for (const row of rows) {
    const id = String(row.key);

    usages.set(id, { tokens: tokens(row), costUsd: cost(row), context: contexts.get(id) ?? null });
  }

  return usages;
}
