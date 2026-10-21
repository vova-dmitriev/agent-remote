import { type RateLimit, UsageProvider } from '@protocol';
import { z } from 'zod';
import { NotificationKind } from '../../domain/notifications.js';
import type { NotificationCopy } from '../copy/messages.js';

/** Highest first: a window that jumps past both is told once, at the higher one. */
const THRESHOLDS = [95, 80];
const MINUTE_MS = 60_000;

const AGENTS: Record<UsageProvider, string> = {
  [UsageProvider.Claude]: 'Claude',
  [UsageProvider.Codex]: 'Codex',
};

const RATE_LIMIT_KINDS: ReadonlySet<string> = new Set([
  NotificationKind.RateLimit,
  NotificationKind.RateLimitReset,
]);

export const isRateLimitKind = (kind: string) => RATE_LIMIT_KINDS.has(kind);

const payloadSchema = z.strictObject({
  provider: z.enum(UsageProvider),
  windowMinutes: z.number().int().positive(),
  usedPercent: z.number().int().min(0).max(100),
  resetsAt: z.number().int().nonnegative(),
});

export interface RateLimitAlert {
  key: string;
  kind: NotificationKind;
  payload: z.infer<typeof payloadSchema>;
  /** When to send it: now for a threshold, the window's reset for the reset. */
  at: number;
}

/**
 * What the owner should hear about these windows: the highest threshold each has passed, and later its reset. Keys
 * name the window's cycle, so a threshold is told once per cycle however many snapshots and devices report it.
 */
export function rateLimitAlerts(limits: readonly RateLimit[], now: number): RateLimitAlert[] {
  return limits.flatMap((limit) => {
    const threshold = THRESHOLDS.find((value) => limit.usedPercent >= value);

    if (!threshold || limit.resetsAt <= now) {
      return [];
    }

    // Agents report the same reset a few milliseconds apart, so a cycle is named by its reset minute.
    const cycle = [limit.provider, limit.windowMinutes, Math.round(limit.resetsAt / MINUTE_MS)].join(':');

    const payload = {
      provider: limit.provider,
      windowMinutes: limit.windowMinutes,
      usedPercent: Math.round(limit.usedPercent),
      resetsAt: limit.resetsAt,
    };

    return [
      { key: `limit:${cycle}:${threshold}`, kind: NotificationKind.RateLimit, payload, at: now },
      { key: `limit-reset:${cycle}`, kind: NotificationKind.RateLimitReset, payload, at: limit.resetsAt },
    ];
  });
}

/** The message for a rate-limit notification, or undefined when its payload is not one. */
export function rateLimitText(copy: NotificationCopy, kind: string, payload: unknown, now: number) {
  const parsed = payloadSchema.safeParse(payload);

  if (!parsed.success) {
    return undefined;
  }

  const { provider, windowMinutes, usedPercent, resetsAt } = parsed.data;
  const agent = AGENTS[provider];
  const window = copy.limitWindow(windowMinutes);

  return kind === NotificationKind.RateLimitReset
    ? copy.rateLimitReset(agent, window)
    : copy.rateLimitHigh(agent, window, usedPercent, copy.duration(Math.max(0, resetsAt - now)));
}
