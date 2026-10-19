import {
  EventType,
  HistoryDirection,
  ToolActivityPhase,
  historySchema,
  type EventEnvelope,
  type HistoryMessage,
  type HistoryPageDirection,
} from "@protocol"
import { SUBAGENT_MESSAGE_LIMIT } from "../config/subagent"

/** Adds one transcript page to a subagent view: items are replaced by id, ordered by time and bounded from the far end. */
export function mergeSubagentPage(
  current: readonly HistoryMessage[],
  events: readonly EventEnvelope[],
  direction: HistoryPageDirection = HistoryDirection.After,
): HistoryMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]))

  for (const event of events) {
    if (event.type !== EventType.Message) continue
    const parsed = historySchema.safeParse(event.payload)

    if (parsed.success) byId.set(parsed.data.id, parsed.data)
  }

  const merged = [...byId.values()].sort((a, b) => a.occurredAt - b.occurredAt)

  return direction === HistoryDirection.Before ? merged.slice(0, SUBAGENT_MESSAGE_LIMIT) : merged.slice(-SUBAGENT_MESSAGE_LIMIT)
}

/**
 * Shows each tool call once: a loaded result marks its call completed or failed and is not shown on its own.
 * A result whose call is outside the loaded window stays as its own line.
 */
export function foldToolResults(messages: readonly HistoryMessage[]): HistoryMessage[] {
  const outcomes = new Map<string, HistoryMessage>()
  const calls = new Set<string>()

  for (const message of messages) {
    if (!message.tool) continue
    if (message.tool.phase === ToolActivityPhase.Started) calls.add(message.tool.id)
    else outcomes.set(message.tool.id, message)
  }

  return messages.flatMap((message) => {
    const tool = message.tool

    if (!tool) return [message]
    if (tool.phase !== ToolActivityPhase.Started) return calls.has(tool.id) ? [] : [message]
    const outcome = outcomes.get(tool.id)?.tool?.phase

    return [outcome ? { ...message, tool: { ...tool, phase: outcome } } : message]
  })
}

/** The oldest loaded item's page cursor, so earlier pages continue from what the view shows. */
export function oldestCursor(messages: readonly HistoryMessage[]) {
  return messages.find((message) => message.historyCursor)?.historyCursor
}
