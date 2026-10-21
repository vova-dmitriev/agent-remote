import { readFile, stat } from 'node:fs/promises';
import { UsageProvider, type RateLimit } from '@protocol';
import { ClaudeUsageWindowMinutes } from '../../domain/claude.js';
import { count, record } from './usage-row.js';

/** `.claude.json` holds settings and project history; anything past this is not the file Claude Code writes. */
const MAX_STATE_BYTES = 16 * 1024 * 1024;

/**
 * Claude's plan limits as Claude Code last fetched them. It caches them in its state file, undocumented: a missing
 * or changed shape yields no windows rather than a guess. Only the percentages and times leave this function.
 */
export async function claudeLimits(path: string): Promise<RateLimit[]> {
  try {
    const info = await stat(path);

    if (!info.isFile() || info.size > MAX_STATE_BYTES) {
      return [];
    }

    const cached = record(record(JSON.parse(await readFile(path, 'utf8'))).cachedUsageUtilization);
    const observedAt = count(cached.fetchedAtMs);
    const windows = record(cached.utilization);

    return Object.entries(ClaudeUsageWindowMinutes).flatMap(([name, windowMinutes]) => {
      const window = record(windows[name]);
      const resetsAt = Date.parse(String(window.resets_at));

      return typeof window.utilization === 'number' && Number.isFinite(resetsAt) && observedAt
        ? [
            {
              provider: UsageProvider.Claude,
              windowMinutes,
              usedPercent: Math.min(100, Math.max(0, window.utilization)),
              resetsAt,
              observedAt,
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}
