import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startAnalytics } from '@daemon/analytics/live.js';
import { localFixture } from '../../helpers/local/local-runtime.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'analytics-live-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("puts a session's usage on its snapshot entry after a read of the transcripts", async () => {
  const f = localFixture();
  const project = join(directory, 'claude', 'projects', '-work-synthetic');

  await mkdir(project, { recursive: true });

  await writeFile(
    join(project, 'synthetic-session.jsonl'),
    JSON.stringify({
      type: 'assistant',
      sessionId: f.session.claudeSessionId,
      cwd: '/work/synthetic',
      timestamp: new Date().toISOString(),
      message: {
        id: 'msg-1',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 1_000_000, output_tokens: 7 },
      },
    }) + '\n',
  );

  const analytics = startAnalytics(f.monitor, {
    path: join(directory, 'analytics.sqlite'),
    claudeHomes: [join(directory, 'claude')],
    codexHomes: [],
    claudeStates: [],
  });

  try {
    await analytics?.pass();

    expect(f.monitor.snapshot().sessions.find((session) => session.id === f.session.id)?.usage).toEqual({
      tokens: { input: 1_000_000, output: 7, cacheRead: 0, cacheWrite: 0 },
      costUsd: 4 + (7 * 20) / 1e6,
      context: null,
    });
  } finally {
    await analytics?.close();
    await f.close();
  }
});
