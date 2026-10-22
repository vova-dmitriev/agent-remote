import type { HistoryMessage } from "@protocol"
import type { RailViewport } from "@/pages/session/lib/rail-layout"
import { railEntries } from "./subagent-history"

interface RailMap {
  starts: readonly number[]
  total: number
  viewport: RailViewport
}

/**
 * What the rail marks. While the loaded feed holds every owner's message the outline knows, their feed offsets at the
 * native scrollbar's scale; otherwise every owner's message of the conversation, evenly spaced in conversation order,
 * so messages outside the loaded window keep their marks.
 */
export function railMarks(messages: HistoryMessage[], map: RailMap, outline: readonly HistoryMessage[]) {
  const loaded = railEntries(messages, map.starts)
  const ids = new Set(loaded.messages.map((message) => message.id))
  const outside = outline.filter((message) => !ids.has(message.id))

  if (!outside.length) return { ...map, ...loaded }
  const marked = [...loaded.messages, ...outside].sort((a, b) => a.occurredAt - b.occurredAt)

  return {
    messages: marked,
    starts: marked.map((_, index) => index + 0.5),
    total: marked.length,
    viewport: { scrollTop: 0, clientHeight: 0, scrollHeight: marked.length },
  }
}
