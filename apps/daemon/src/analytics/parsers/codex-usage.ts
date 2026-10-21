import { UsageProvider, type RateLimit, type SessionUsage } from '@protocol';
import { CodexEventType, CodexItemType, CodexRolloutType } from '../../domain/codex/codex.js';
import { count, record, text, usageRow, type UsageRow } from './usage-row.js';

/** What a rollout file said before the line being read: its thread, folder and current model. */
export interface CodexFileState {
  thread?: string | undefined;
  cwd?: string | undefined;
  model?: string | undefined;
}

interface CodexRead {
  row?: UsageRow;
  context?: NonNullable<SessionUsage['context']>;
  limits?: RateLimit[];
}

const TOKEN_FIELDS = ['input_tokens', 'cached_input_tokens', 'output_tokens'];

const MARKERS = [CodexItemType.SessionMeta, CodexItemType.TurnContext, CodexEventType.TokenCount];

function limit(value: unknown, observedAt: number): RateLimit[] {
  const window = record(value);

  return typeof window.used_percent === 'number' && count(window.window_minutes) && count(window.resets_at)
    ? [
        {
          provider: UsageProvider.Codex,
          windowMinutes: count(window.window_minutes),
          usedPercent: Math.min(100, Math.max(0, window.used_percent)),
          resetsAt: count(window.resets_at) * 1000,
          observedAt,
        },
      ]
    : [];
}

/**
 * One rollout line. Codex repeats a token count when only its rate limits change, and replays earlier ones after a
 * rollback, so a request is keyed by the thread's running total and its own usage: a repeat is identical in both,
 * while a request after a rollback can reach a running total seen before with different usage of its own.
 */
export function codexUsage(line: string, state: CodexFileState): CodexRead {
  if (!MARKERS.some((marker) => line.includes(marker))) {
    return {};
  }

  let row: Record<string, unknown>;

  try {
    row = record(JSON.parse(line));
  } catch {
    return {};
  }

  const payload = record(row.payload);

  if (row.type === CodexItemType.SessionMeta) {
    // A rollout is one thread; a later `session_meta` describes the thread it was forked from.
    state.thread ??= text(payload.id);
    state.cwd ??= text(payload.cwd);

    return {};
  }

  if (row.type === CodexItemType.TurnContext) {
    state.model = text(payload.model) ?? state.model;
    state.cwd = text(payload.cwd) ?? state.cwd;

    return {};
  }

  const info = record(payload.info);
  const total = record(info.total_token_usage);
  const last = record(info.last_token_usage);
  const at = Date.parse(String(row.timestamp));

  if (row.type !== CodexRolloutType.EventMessage || payload.type !== CodexEventType.TokenCount) {
    return {};
  }

  if (!state.thread || !Object.keys(total).length || !Number.isFinite(at)) {
    return {};
  }

  const rates = record(payload.rate_limits);
  const input = count(last.input_tokens);
  const cacheRead = count(last.cached_input_tokens);
  const cacheWrite = count(last.cache_write_input_tokens);

  const key = [
    state.thread,
    ...[total, last].flatMap((usage) => TOKEN_FIELDS.map((field) => count(usage[field]))),
  ];

  return {
    row: usageRow({
      provider: UsageProvider.Codex,
      key: key.join(':'),
      sessionId: state.thread,
      project: state.cwd ?? '',
      model: state.model ?? '',
      at,
      input: Math.max(0, input - cacheRead - cacheWrite),
      output: count(last.output_tokens),
      cacheRead,
      cacheWrite,
      cacheWriteLong: 0,
    }),
    ...(count(info.model_context_window)
      ? { context: { used: input, window: count(info.model_context_window) } }
      : {}),
    ...(payload.rate_limits ? { limits: [...limit(rates.primary, at), ...limit(rates.secondary, at)] } : {}),
  };
}
