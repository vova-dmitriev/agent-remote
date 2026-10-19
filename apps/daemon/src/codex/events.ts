import { CodexItemType, CodexContentType } from '../domain/codex/codex.js';
import { MessageRole, truncateUtf8, type HistoryMessage } from '@protocol';

export type Data = Record<string, unknown>;
export const object = (value: unknown): Data =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {};

export function itemMessage(
  raw: unknown,
  turnId: string,
  occurredAt = Date.now(),
): HistoryMessage | undefined {
  const item = object(raw);

  if (
    typeof item.id !== 'string' ||
    ![CodexItemType.UserMessage, CodexItemType.AgentMessage].some(
      (candidateValue) => candidateValue === String(item.type),
    )
  ) {
    return;
  }

  let text = item.type === CodexItemType.AgentMessage ? item.text : '';

  if (item.type !== CodexItemType.AgentMessage && Array.isArray(item.content)) {
    text = item.content
      .filter((part) => object(part).type === CodexContentType.Text)
      .map((part) => object(part).text)
      .filter((value) => typeof value === 'string')
      .join('\n');
  }

  if (typeof text !== 'string' || !text) {
    return;
  }

  return {
    id: `${turnId}:${item.id}`,
    role: item.type === CodexItemType.UserMessage ? MessageRole.User : MessageRole.Assistant,
    text: truncateUtf8(text, 65_536),
    occurredAt,
  };
}
