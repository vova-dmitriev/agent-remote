import {
  EventType,
  HistoryDirection,
  ToolActivityPhase,
  historySchema,
  type EventEnvelope,
  type HistoryMessage,
  type HistoryNavigationDirection,
} from "@protocol"
import { SUBAGENT_MESSAGE_LIMIT } from "../config/subagent"

function pageMessages(events: readonly EventEnvelope[]) {
  return events.flatMap((event) => {
    if (event.type !== EventType.Message) return []
    const parsed = historySchema.safeParse(event.payload)

    return parsed.success ? [parsed.data] : []
  })
}

/**
 * Adds one transcript page to a subagent view: items are replaced by id, ordered by time and bounded from the far end.
 * A latest page that shares no item with the loaded ones replaces them, so missed polls never leave a silent hole;
 * the earlier items stay reachable by paging back from the new page's oldest item.
 */
export function mergeSubagentPage(
  current: readonly HistoryMessage[],
  events: readonly EventEnvelope[],
  direction: HistoryNavigationDirection = HistoryDirection.Latest,
): HistoryMessage[] {
  const page = pageMessages(events)
  const loaded = new Set(current.map((message) => message.id))
  const gap = direction === HistoryDirection.Latest && current.length > 0 && page.length > 0 && !page.some((m) => loaded.has(m.id))
  const byId = new Map(gap ? [] : current.map((message) => [message.id, message]))

  for (const message of page) byId.set(message.id, message)
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

/** Conversation messages only: tool activity lines get no navigation marker. */
export function railMessages(messages: HistoryMessage[]) {
  return messages.some((message) => message.tool) ? messages.filter((message) => !message.tool) : messages
}

/** The marker to highlight for the item being read: a tool line maps to the nearest conversation message before it, else after it. */
export function railActiveId(messages: readonly HistoryMessage[], activeId: string | null) {
  const index = messages.findIndex((message) => message.id === activeId)

  if (index < 0 || !messages[index]!.tool) return activeId
  const before = messages.slice(0, index).findLast((message) => !message.tool)

  return (before ?? messages.slice(index + 1).find((message) => !message.tool))?.id ?? null
}
