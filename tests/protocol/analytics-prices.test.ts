import {
  AnalyticsPeriod,
  UsageProvider,
  analyticsReportSchema,
  costUsd,
  priceFor,
  sessionUsageSchema,
} from '@protocol';
import { expect, it } from 'vitest';

const usage = (part: Partial<Parameters<typeof costUsd>[0]>) => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cacheWriteLong: 0,
  ...part,
});

it('prices a dated or context-tagged model id as its model, and a different model not at all', () => {
  expect(priceFor('claude-opus-5-5-20261001')).toBe(priceFor('claude-opus-5-5'));
  expect(priceFor('claude-opus-5-5[1m]')).toBe(priceFor('claude-opus-5-5'));
  expect(priceFor('claude-opus-5')).not.toBe(priceFor('claude-opus-5-5'));
  expect(priceFor('claude-opus-5-7')).toBeUndefined();
  expect(priceFor('gpt-5.5-pro')).toBeUndefined();
  expect(priceFor('gpt-5.5-2026-09-01')).toBe(priceFor('gpt-5.5'));
  expect(priceFor('synthetic-model')).toBeUndefined();
});

it('costs every token kind per million', () => {
  const price = priceFor('claude-opus-5-5')!;

  expect(
    costUsd(
      usage({
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
        cacheWriteLong: 1_000_000,
      }),
      price,
    ),
  ).toBeCloseTo(4 + 20 + 0.2 + 5 + 8);

  expect(costUsd(usage({ output: 1000 }), priceFor('gpt-6.1-sol')!)).toBeCloseTo(0.01);
});

it('charges a long prompt the long-context price when the model has one', () => {
  const haiku = priceFor('claude-haiku-5-5')!;

  expect(costUsd(usage({ input: 100_000, output: 1_000_000 }), haiku)).toBeCloseTo(0.01 + 0.5);

  expect(costUsd(usage({ input: 1, cacheRead: 100_000, output: 1_000_000 }), haiku)).toBeCloseTo(
    0.000_000_5 + 0.005 + 2.5,
  );
});

it('accepts a report and a session usage with unpriced cost', () => {
  const tokens = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 };
  const row = { key: 'synthetic-model', label: 'synthetic-model', tokens, costUsd: null };

  expect(sessionUsageSchema.parse({ tokens, costUsd: null, context: null })).toEqual({
    tokens,
    costUsd: null,
    context: null,
  });

  expect(
    analyticsReportSchema.parse({
      period: AnalyticsPeriod.Today,
      importing: { done: 1, total: 2 },
      totals: { tokens, costUsd: null },
      byModel: [row],
      byProject: [row],
      bySession: [{ ...row, provider: UsageProvider.Claude, lastAt: 1 }],
      daily: [{ day: '2026-10-21', tokens, costUsd: null }],
      rateLimits: [],
    }).byModel,
  ).toEqual([row]);
});
