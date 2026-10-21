import { UsageProvider } from '@protocol';
import { ClaudeRecordType } from '../../domain/claude.js';
import { count, record, text, usageRow, type UsageRow } from './usage-row.js';

/**
 * The request an assistant record reports. Claude writes one record per content block with the same message id, so
 * the key is that id (the store keeps the record with the most output). A subagent transcript names its parent session.
 */
export function claudeUsageRow(line: string): UsageRow | undefined {
  if (!line.includes('"usage"') || !line.includes(ClaudeRecordType.Assistant)) {
    return undefined;
  }

  let row: Record<string, unknown>;

  try {
    row = record(JSON.parse(line));
  } catch {
    return undefined;
  }

  const message = record(row.message);
  const usage = record(message.usage);
  const key = text(message.id);
  const sessionId = text(row.sessionId);
  const model = text(message.model);
  const at = Date.parse(String(row.timestamp));

  if (row.type !== ClaudeRecordType.Assistant || !key || !sessionId || !model || !Number.isFinite(at)) {
    return undefined;
  }

  const writes = record(usage.cache_creation);
  const cacheWriteLong = count(writes.ephemeral_1h_input_tokens);

  const tokens = {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: Math.max(0, count(usage.cache_creation_input_tokens) - cacheWriteLong),
    cacheWriteLong,
  };

  // Claude Code's own error replies (model `<synthetic>`) report no tokens and are no request.
  if (!Object.values(tokens).some(Boolean)) {
    return undefined;
  }

  return usageRow({
    provider: UsageProvider.Claude,
    key,
    sessionId,
    project: text(row.cwd) ?? '',
    model,
    at,
    ...tokens,
  });
}
