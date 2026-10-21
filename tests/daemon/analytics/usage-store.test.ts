import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageProvider } from '@protocol';
import Sqlite from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { UsageStore } from '@daemon/analytics/store.js';
import { usageRow } from '@daemon/analytics/parsers/usage-row.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'analytics-store-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const row = (key: string, output: number) =>
  usageRow({
    provider: UsageProvider.Claude,
    key,
    sessionId: 'synthetic-session',
    project: '/work/synthetic',
    model: 'claude-opus-5-5',
    at: Date.parse('2026-10-21T09:00:00.000Z'),
    input: 1,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    cacheWriteLong: 0,
  });

const outputs = (store: UsageStore) =>
  store.query('SELECT key, output FROM usage ORDER BY key').map((r) => [r.key, Number(r.output)]);

it('keeps one record per request, the one with the most output, and remembers file offsets', async () => {
  const path = join(directory, 'analytics.sqlite');
  const store = UsageStore.open(path);
  const file = { path: '/work/a.jsonl', inode: 7, offset: 120, state: { thread: 'thread-1' } };

  store.save([row('msg-1', 1), row('msg-1', 5), row('msg-2', 2)], file);
  // A shorter copy of the request read later, as from an older transcript, does not replace the full one.
  store.save([row('msg-1', 3)], { ...file, offset: 200 });

  expect(outputs(store)).toEqual([
    ['msg-1', 5],
    ['msg-2', 2],
  ]);

  expect(store.files().get('/work/a.jsonl')).toEqual({ ...file, offset: 200 });
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  store.close();

  const reopened = UsageStore.open(path);

  expect(outputs(reopened)).toHaveLength(2);
  reopened.close();
});

it('keeps the newest rate limits whatever order files are read in', async () => {
  const store = UsageStore.open(join(directory, 'analytics.sqlite'));

  const window = (usedPercent: number) => [
    { provider: UsageProvider.Codex, usedPercent, windowMinutes: 300, resetsAt: 1, observedAt: 1 },
  ];

  const file = { path: '/work/b.jsonl', inode: 1, offset: 1, state: {} };

  store.save([], file, { at: 20, limits: window(40) });
  store.save([], file, { at: 10, limits: window(90) });
  expect(store.limits()[0]?.usedPercent).toBe(40);
  store.close();
});

it('rebuilds the store when its schema version is not this one', async () => {
  const path = join(directory, 'analytics.sqlite');
  const store = UsageStore.open(path);

  store.save([row('msg-1', 1)], { path: '/work/a.jsonl', inode: 1, offset: 9, state: {} });
  store.close();

  const older = new Sqlite(path);

  older.prepare("UPDATE meta SET value = '0' WHERE name = 'schema'").run();
  older.close();

  const rebuilt = UsageStore.open(path);

  expect(outputs(rebuilt)).toEqual([]);
  expect(rebuilt.files().size).toBe(0);
  rebuilt.close();
});
