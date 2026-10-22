import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalyticsPeriod, UNKNOWN_USAGE_KEY, UsageProvider } from '@protocol';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { UsageStore } from '@daemon/analytics/store.js';
import { periodStart, usageReport, sessionUsages } from '@daemon/analytics/report.js';
import { usageRow } from '@daemon/analytics/parsers/usage-row.js';

let directory: string;
let zone: string | undefined;

beforeEach(async () => {
  zone = process.env.TZ;
  process.env.TZ = 'Europe/Moscow';
  directory = await mkdtemp(join(tmpdir(), 'analytics-report-'));
});

afterEach(async () => {
  process.env.TZ = zone;
  await rm(directory, { recursive: true, force: true });
});

// 00:30 on 21 October in Moscow is still 20 October in UTC.
const NOW = Date.parse('2026-10-21T12:00:00+03:00');
const EARLY = Date.parse('2026-10-21T00:30:00+03:00');
const YESTERDAY = Date.parse('2026-10-20T23:30:00+03:00');
const LAST_MONTH = Date.parse('2026-09-01T10:00:00+03:00');

const row = (
  key: string,
  at: number,
  part: { model?: string; sessionId?: string; provider?: UsageProvider },
) =>
  usageRow({
    provider: part.provider ?? UsageProvider.Claude,
    key,
    sessionId: part.sessionId ?? 'session-a',
    project: '/work/alpha',
    model: part.model ?? 'claude-opus-5-5',
    at,
    input: 1_000_000,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cacheWriteLong: 0,
  });

function filled() {
  const store = UsageStore.open(join(directory, 'analytics.sqlite'));

  store.save(
    [
      row('a', EARLY, {}),
      row('b', YESTERDAY, { model: 'synthetic-model', sessionId: 'session-b' }),
      row('c', LAST_MONTH, { model: '', sessionId: 'thread-c', provider: UsageProvider.Codex }),
    ],
    { path: '/work/a.jsonl', inode: 1, offset: 1, state: {} },
  );

  return store;
}

it('starts today at local midnight and a week six days before it', () => {
  expect(periodStart(AnalyticsPeriod.Today, NOW)).toBe(Date.parse('2026-10-21T00:00:00+03:00'));
  expect(periodStart(AnalyticsPeriod.Week, NOW)).toBe(Date.parse('2026-10-15T00:00:00+03:00'));
  expect(periodStart(AnalyticsPeriod.All, NOW)).toBe(0);
});

it('counts a session at 00:30 local time as today', async () => {
  const store = filled();
  const report = usageReport(store, AnalyticsPeriod.Today, null, [], NOW);

  expect(report.totals).toEqual({
    tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 4,
  });

  expect(report.daily).toEqual([{ day: '2026-10-21', tokens: report.totals.tokens, costUsd: 4 }]);
  store.close();
});

it('groups by model, project and session, with no price for an unknown model', async () => {
  const store = filled();
  const report = usageReport(store, AnalyticsPeriod.All, { done: 1, total: 3 }, [], NOW);

  expect(report.importing).toEqual({ done: 1, total: 3 });

  expect(report.byModel.map((model) => [model.key, model.costUsd])).toEqual([
    ['claude-opus-5-5', 4],
    [UNKNOWN_USAGE_KEY, null],
    ['synthetic-model', null],
  ]);

  expect(report.byProject).toEqual([
    expect.objectContaining({ key: '/work/alpha', label: 'alpha', costUsd: 4 }),
  ]);

  expect(report.bySession.map((session) => [session.key, session.provider, session.lastAt])).toEqual([
    ['session-a', UsageProvider.Claude, EARLY],
    ['session-b', UsageProvider.Claude, YESTERDAY],
    ['thread-c', UsageProvider.Codex, LAST_MONTH],
  ]);

  expect(report.daily.map((day) => day.day)).toEqual(['2026-09-01', '2026-10-20', '2026-10-21']);
  store.close();
});

it('sums a live session over all time, with the context it last reported', async () => {
  const store = filled();
  const context = { used: 10, window: 100 };

  const usages = sessionUsages(store, ['session-a', 'thread-c', 'missing'], new Map([['thread-c', context]]));

  expect(usages.get('session-a')).toEqual({
    tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 4,
    context: null,
  });

  expect(usages.get('thread-c')).toMatchObject({ costUsd: null, context });
  expect(usages.has('missing')).toBe(false);
  store.close();
});

it("narrows the report to one session and one day, while the days stay the session's whole period", () => {
  const store = filled();

  const session = usageReport(store, AnalyticsPeriod.All, null, [], NOW, { session: 'session-b' });

  expect(session.bySession.map((item) => item.key)).toEqual(['session-b']);
  expect(session.byModel.map((item) => item.key)).toEqual(['synthetic-model']);
  expect(session.daily.map((item) => item.day)).toEqual(['2026-10-20']);

  const day = usageReport(store, AnalyticsPeriod.All, null, [], NOW, { day: '2026-10-21' });

  expect(day.bySession.map((item) => item.key)).toEqual(['session-a']);
  expect(day.totals.tokens.input).toBe(1_000_000);
  expect(day.daily.map((item) => item.day)).toEqual(['2026-09-01', '2026-10-20', '2026-10-21']);
  store.close();
});
