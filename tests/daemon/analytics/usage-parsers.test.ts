import { UsageProvider } from '@protocol';
import { expect, it } from 'vitest';
import { claudeUsageRow } from '@daemon/analytics/parsers/claude-usage.js';
import { codexUsage, type CodexFileState } from '@daemon/analytics/parsers/codex-usage.js';

const assistant = (id: string, output: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    sessionId: 'synthetic-session',
    cwd: '/work/synthetic',
    timestamp: '2026-10-21T09:00:00.000Z',
    message: {
      id,
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: 10,
        output_tokens: output,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 30,
        cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 10 },
      },
    },
    ...extra,
  });

it('reads one Claude request per assistant record, keyed by its message id', () => {
  expect(claudeUsageRow(assistant('msg-1', 5))).toMatchObject({
    provider: UsageProvider.Claude,
    key: 'msg-1',
    sessionId: 'synthetic-session',
    project: '/work/synthetic',
    model: 'claude-opus-5-5',
    at: Date.parse('2026-10-21T09:00:00.000Z'),
    input: 10,
    output: 5,
    cacheRead: 100,
    cacheWrite: 20,
    cacheWriteLong: 10,
  });

  expect(claudeUsageRow(assistant('msg-1', 5))?.costUsd).toBeCloseTo(
    (10 * 4 + 5 * 20 + 100 * 0.2 + 20 * 5 + 10 * 8) / 1e6,
  );

  // A subagent transcript names its parent session, so its requests count for that session.
  expect(claudeUsageRow(assistant('msg-2', 1, { isSidechain: true }))?.sessionId).toBe('synthetic-session');
});

it('ignores Claude records without usage and unpriced models cost nothing known', () => {
  expect(claudeUsageRow(JSON.stringify({ type: 'user', message: { content: 'usage' } }))).toBeUndefined();
  expect(claudeUsageRow('{"type":"assistant","usage": broken')).toBeUndefined();

  const empty = JSON.parse(assistant('msg-4', 0));

  empty.message.usage = { input_tokens: 0, output_tokens: 0 };
  expect(claudeUsageRow(JSON.stringify(empty))).toBeUndefined();

  const unknown = JSON.parse(assistant('msg-3', 1));

  unknown.message.model = 'synthetic-model';
  expect(claudeUsageRow(JSON.stringify(unknown))?.costUsd).toBeNull();
});

const meta = JSON.stringify({ type: 'session_meta', payload: { id: 'thread-1', cwd: '/work/codex' } });
const context = (model: string) => JSON.stringify({ type: 'turn_context', payload: { model } });

const tokens = (total: number, last: number, at = '2026-10-21T10:00:00.000Z') =>
  JSON.stringify({
    type: 'event_msg',
    timestamp: at,
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: total,
          cached_input_tokens: 0,
          output_tokens: total,
          total_tokens: total * 2,
        },
        last_token_usage: {
          input_tokens: last,
          cached_input_tokens: last / 2,
          cache_write_input_tokens: 0,
          output_tokens: 3,
          total_tokens: last + 3,
        },
        model_context_window: 1000,
      },
      rate_limits: {
        primary: { used_percent: 12.5, window_minutes: 300, resets_at: 1_800_000_000 },
        secondary: null,
      },
    },
  });

it('reads Codex requests with the model of the turn and the thread of the file', () => {
  const state: CodexFileState = {};

  expect(codexUsage(meta, state)).toEqual({});
  expect(codexUsage(context('gpt-6.1-sol'), state)).toEqual({});

  const read = codexUsage(tokens(100, 40), state);

  expect(read.row).toMatchObject({
    provider: UsageProvider.Codex,
    sessionId: 'thread-1',
    project: '/work/codex',
    model: 'gpt-6.1-sol',
    input: 20,
    cacheRead: 20,
    output: 3,
  });

  expect(read.context).toEqual({ used: 40, window: 1000 });

  expect(read.limits).toEqual([
    {
      provider: UsageProvider.Codex,
      windowMinutes: 300,
      usedPercent: 12.5,
      resetsAt: 1_800_000_000_000,
      observedAt: Date.parse('2026-10-21T10:00:00.000Z'),
    },
  ]);
});

it('keys a repeated Codex token count like the first, so it is counted once', () => {
  const state: CodexFileState = {};

  codexUsage(meta, state);

  const first = codexUsage(tokens(100, 40), state).row;
  const repeated = codexUsage(tokens(100, 40, '2026-10-21T10:00:05.000Z'), state).row;
  const next = codexUsage(tokens(140, 40), state).row;

  // After a rollback the running total can come back to 100 for a request of a different size.
  const afterRollback = codexUsage(tokens(100, 20), state).row;

  expect(repeated?.key).toBe(first?.key);
  expect(next?.key).not.toBe(first?.key);
  expect(afterRollback?.key).not.toBe(first?.key);
});

it('keeps the thread of the first session_meta when a forked rollout names its source later', () => {
  const state: CodexFileState = {};

  codexUsage(meta, state);

  codexUsage(
    JSON.stringify({ type: 'session_meta', payload: { id: 'thread-source', cwd: '/work/other' } }),
    state,
  );

  expect(codexUsage(tokens(100, 40), state).row).toMatchObject({
    sessionId: 'thread-1',
    project: '/work/codex',
  });
});

it('ignores a Codex token count before the file names its thread', () => {
  expect(codexUsage(tokens(100, 40), {})).toEqual({});
});
