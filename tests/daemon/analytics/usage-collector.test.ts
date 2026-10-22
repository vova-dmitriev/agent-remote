import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalyticsPeriod } from '@protocol';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AnalyticsCollector } from '@daemon/analytics/collector.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'analytics-collector-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const assistant = (id: string, output: number) =>
  JSON.stringify({
    type: 'assistant',
    sessionId: 'synthetic-session',
    cwd: '/work/synthetic',
    timestamp: new Date().toISOString(),
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: output } },
  }) + '\n';

const output = async (collector: AnalyticsCollector) =>
  (await collector.report({ period: AnalyticsPeriod.Today })).totals.tokens.output;

it('reads appended lines once, waits for a line to finish, and re-reads a replaced file without double counting', async () => {
  const claude = join(directory, 'claude');
  const project = join(claude, 'projects', '-work-synthetic');
  const transcript = join(project, 'synthetic-session.jsonl');

  await mkdir(join(project, 'synthetic-session', 'subagents'), { recursive: true });
  await writeFile(transcript, assistant('msg-1', 1) + assistant('msg-1', 2));
  await writeFile(join(project, 'synthetic-session', 'subagents', 'agent-1.jsonl'), assistant('msg-sub', 10));

  const collector = AnalyticsCollector.start({
    path: join(directory, 'analytics.sqlite'),
    claudeHomes: [claude],
    codexHomes: [join(directory, 'missing-codex')],
    claudeStates: [],
    intervalMs: 60_000,
  });

  await collector.pass();
  expect(await output(collector)).toBe(12);

  const half = assistant('msg-2', 100);

  await appendFile(transcript, half.slice(0, 20));
  await collector.pass();
  expect(await output(collector)).toBe(12);

  await appendFile(transcript, half.slice(20));
  await collector.pass();
  expect(await output(collector)).toBe(112);

  // The same requests in a new file at the same path: a new inode, read from the start, keyed rows replaced.
  await writeFile(transcript + '.next', assistant('msg-1', 2) + assistant('msg-2', 100));
  await rename(transcript + '.next', transcript);
  await collector.pass();
  expect(await output(collector)).toBe(112);
  expect((await collector.report({ period: AnalyticsPeriod.Today })).importing).toBeNull();
  await collector.close();
});
