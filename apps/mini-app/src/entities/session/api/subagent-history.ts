import { HistoryDirection, HistoryQueryKey, type EventEnvelope, type HistoryNavigationDirection } from "@protocol"
import { HistoryWindow } from "./history-window"

type HistoryRequest = (path: string, observe: (response: Response) => void) => Promise<EventEnvelope[]>

/** Open subagent views whose paging state is kept; the oldest is dropped first. */
const SUBAGENT_WINDOW_LIMIT = 8

/**
 * Paging state of each subagent transcript on the relay transport, apart from the parent session's window.
 * A view of a new session generation starts with a Latest read, which resets that subagent's cursors.
 */
export class SubagentHistory {
  private windows = new Map<string, HistoryWindow>()

  constructor(private readonly request: HistoryRequest) {}

  reset() {
    this.windows.clear()
  }

  async page(sessionId: string, agentId: string, direction: HistoryNavigationDirection, current: () => boolean, edge?: string) {
    const window = this.window(sessionId, agentId)
    const path = "/sessions/" + encodeURIComponent(sessionId) + "/events"

    if (direction !== HistoryDirection.Latest)
      return window.page(direction, (query, observe) => this.request(path + query, observe), current, edge, agentId)

    if (!current()) return null
    window.reset()

    const events = await this.request(path + "?" + HistoryQueryKey.AgentId + "=" + encodeURIComponent(agentId), (response) => {
      if (current())
        window.observe({ before: response.headers.get("x-next-cursor") ?? "", after: response.headers.get("x-after-cursor") ?? "" })
    })

    return current() ? events : null
  }

  private window(sessionId: string, agentId: string) {
    const key = sessionId + "\u0000" + agentId
    const existing = this.windows.get(key)

    if (existing) return existing
    const created = new HistoryWindow()

    this.windows.set(key, created)
    if (this.windows.size > SUBAGENT_WINDOW_LIMIT) this.windows.delete(this.windows.keys().next().value!)

    return created
  }
}
