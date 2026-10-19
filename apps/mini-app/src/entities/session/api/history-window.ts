import { HistoryPageDirection, HistoryDirection, HistoryQueryKey, type EventEnvelope } from "@protocol"
import { HistoryPageSkip } from "@/shared/api"
import type { HistoryCursors } from "./history"

export class HistoryWindow {
  private cursors: HistoryCursors = { before: "", after: "" }
  private busy = false
  private exhausted = new Set<string>()
  /** Whether a history load reported this window's cursors; before that a missing cursor proves nothing. */
  private loaded = false

  reset() {
    this.exhausted.clear()
    this.cursors = { before: "", after: "" }
    this.loaded = false
  }

  observe = (cursors: HistoryCursors) => {
    this.cursors = cursors
    this.loaded = true
  }

  async page(
    direction: HistoryPageDirection,
    request: (query: string, observe: (response: Response) => void) => Promise<EventEnvelope[]>,
    current: () => boolean,
    edge?: string,
    agentId?: string,
  ) {
    const cursor = edge?.startsWith("position:")
      ? "source:" + edge.slice(9)
      : edge?.startsWith("cache:")
        ? edge.slice(6)
        : this.cursors[direction]

    const key = direction + ":" + cursor

    if (!current() || (!cursor && !this.loaded)) return HistoryPageSkip.Stale
    if (!cursor || this.exhausted.has(key)) return HistoryPageSkip.Exhausted
    if (this.busy) return HistoryPageSkip.Busy
    this.busy = true

    try {
      const subagent = agentId ? "&" + HistoryQueryKey.AgentId + "=" + encodeURIComponent(agentId) : ""

      const events = await request("?" + direction + "=" + encodeURIComponent(cursor) + subagent, (response) => {
        if (current())
          this.cursors[direction] = response.headers.get(direction === HistoryDirection.Before ? "x-next-cursor" : "x-after-cursor") ?? ""
      })

      if (!events.length || (edge && events.every((event) => (event.payload as { historyCursor?: string }).historyCursor === edge)))
        this.exhausted.add(key)
      if (this.exhausted.size > 4) this.exhausted.delete(this.exhausted.values().next().value!)

      return current() ? events : HistoryPageSkip.Stale
    } finally {
      this.busy = false
    }
  }
}
