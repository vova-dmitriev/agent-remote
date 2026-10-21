import { z } from 'zod';
import { AnalyticsPeriod, UsageProvider } from './values.js';

const count = z.number().int().nonnegative().safe();
const time = z.number().int().nonnegative().safe();
const label = z.string().min(1).max(512);
/** API-equivalent dollars; null when the model has no known price. */
const cost = z.number().nonnegative().finite().nullable();

export const usageTokensSchema = z.strictObject({
  input: count,
  output: count,
  cacheRead: count,
  cacheWrite: count,
});

/** One session's tokens, cost and context fill, carried on its snapshot entry. */
export const sessionUsageSchema = z.strictObject({
  tokens: usageTokensSchema,
  costUsd: cost,
  context: z.strictObject({ used: count, window: count }).nullable(),
});

const usageRowSchema = z.strictObject({ key: label, label, tokens: usageTokensSchema, costUsd: cost });

/** One rate-limit window of an agent's plan, as the agent last reported it. */
export const rateLimitSchema = z.strictObject({
  provider: z.enum(UsageProvider),
  /** 300 for Claude's and Codex's five-hour window, 10080 for the weekly one. */
  windowMinutes: count,
  usedPercent: z.number().nonnegative().max(100),
  resetsAt: time,
  /** When the agent reported it; an old reading is stale. */
  observedAt: time,
});

/** Every window of every agent on the device; Claude and Codex have two each. */
export const rateLimitsSchema = z.array(rateLimitSchema).max(8);

export const analyticsQuerySchema = z.strictObject({ period: z.enum(AnalyticsPeriod) });

export const analyticsReportSchema = z.strictObject({
  period: z.enum(AnalyticsPeriod),
  /** Transcripts read so far on the first import; null once the store is current. */
  importing: z.strictObject({ done: count, total: count }).nullable(),
  totals: z.strictObject({ tokens: usageTokensSchema, costUsd: cost }),
  byModel: z.array(usageRowSchema).max(50),
  byProject: z.array(usageRowSchema).max(50),
  bySession: z.array(usageRowSchema.extend({ provider: z.enum(UsageProvider), lastAt: time })).max(100),
  /** Local-time days, oldest first. */
  daily: z
    .array(
      z.strictObject({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
        tokens: usageTokensSchema,
        costUsd: cost,
      }),
    )
    .max(400),
  rateLimits: rateLimitsSchema,
});

export type UsageTokens = z.infer<typeof usageTokensSchema>;
export type SessionUsage = z.infer<typeof sessionUsageSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>;
export type RateLimit = z.infer<typeof rateLimitSchema>;
