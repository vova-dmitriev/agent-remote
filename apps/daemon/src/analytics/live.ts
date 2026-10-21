import type { AppSnapshot, RateLimit, Session, SessionUsage } from '@protocol';
import { logWarning } from '../diagnostics/log.js';
import { AnalyticsCollector, type AnalyticsSources } from './collector.js';

/** The monitor as the collector sees it: the sessions to show usage for, and where to put it. */
interface UsageTarget {
  snapshot(): AppSnapshot;
  setSessionUsage(id: string, usage: SessionUsage | undefined): void;
  setRateLimits(limits: RateLimit[]): void;
}

/** How often the collector looks for new transcript lines. */
const ANALYTICS_INTERVAL_MS = 15_000;

/** The id a session's transcript rows carry: Claude's session id, or the Codex thread. */
const usageKey = (session: Session) =>
  'threadId' in session.target ? session.target.threadId : session.claudeSessionId;

function refresh(collector: AnalyticsCollector, monitor: UsageTarget) {
  const sessions = monitor.snapshot().sessions.flatMap((session) => {
    const key = usageKey(session);

    return key ? [{ id: session.id, key }] : [];
  });

  const usages = collector.sessionUsages(sessions.map((session) => session.key));

  for (const session of sessions) {
    monitor.setSessionUsage(session.id, usages.get(session.key));
  }

  monitor.setRateLimits(collector.limits());
}

/**
 * Starts the usage collector and keeps each session's usage on the snapshot. Without it (another process holds the
 * store cannot open) everything else runs and the app reports usage as unavailable.
 */
export function startAnalytics(
  monitor: UsageTarget,
  options: AnalyticsSources,
): AnalyticsCollector | undefined {
  try {
    const collector: AnalyticsCollector = AnalyticsCollector.start({
      ...options,
      intervalMs: ANALYTICS_INTERVAL_MS,
      onPass: () => {
        try {
          refresh(collector, monitor);
        } catch (error) {
          logWarning('analytics', error);
        }
      },
    });

    return collector;
  } catch (error) {
    logWarning('analytics', error);

    return undefined;
  }
}
