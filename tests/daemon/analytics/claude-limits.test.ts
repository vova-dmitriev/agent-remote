import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageProvider } from '@protocol';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { claudeLimits } from '@daemon/analytics/parsers/claude-limits.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'claude-limits-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('reads the five-hour and weekly windows Claude Code cached, and nothing else', async () => {
  const path = join(directory, '.claude.json');

  await writeFile(
    path,
    JSON.stringify({
      cachedUsageUtilization: {
        fetchedAtMs: 1_000,
        accountUuid: 'synthetic-account',
        utilization: {
          five_hour: { utilization: 6, resets_at: '2026-10-21T10:00:00+00:00' },
          seven_day: { utilization: 74, resets_at: '2026-10-25T03:00:00+00:00' },
          seven_day_opus: null,
        },
      },
    }),
  );

  expect(await claudeLimits(path)).toEqual([
    {
      provider: UsageProvider.Claude,
      windowMinutes: 300,
      usedPercent: 6,
      resetsAt: Date.parse('2026-10-21T10:00:00Z'),
      observedAt: 1_000,
    },
    {
      provider: UsageProvider.Claude,
      windowMinutes: 10_080,
      usedPercent: 74,
      resetsAt: Date.parse('2026-10-25T03:00:00Z'),
      observedAt: 1_000,
    },
  ]);
});

it('yields no windows for a missing file, broken JSON or another shape', async () => {
  const path = join(directory, '.claude.json');

  expect(await claudeLimits(path)).toEqual([]);
  await writeFile(path, '{broken');
  expect(await claudeLimits(path)).toEqual([]);
  await writeFile(path, JSON.stringify({ cachedUsageUtilization: { utilization: { five_hour: 'full' } } }));
  expect(await claudeLimits(path)).toEqual([]);
});
