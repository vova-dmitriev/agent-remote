import { HistoryStatus, FrameType, ErrorCode, type EventEnvelope, type ServerFrame } from "@protocol"
import type { TransportHandlers } from "@/shared/api"

type HistoryRequest = (path: string, observe: (response: Response) => void) => Promise<EventEnvelope[]>
export interface HistoryCursors {
  before: string
  after: string
}

export async function loadSessionHistory(
  sessionId: string,
  request: HistoryRequest,
  current: () => boolean,
  notify: (status: HistoryStatus) => void,
  query: string | (() => Promise<string>) = "",
  cursors?: (value: HistoryCursors) => void,
) {
  if (!current()) return null
  notify(HistoryStatus.Loading)

  try {
    const suffix = typeof query === "function" ? await query() : query

    if (!current()) return null

    const events = await request("/sessions/" + encodeURIComponent(sessionId) + "/events" + suffix, (response) => {
      if (current()) cursors?.({ before: response.headers.get("x-next-cursor") ?? "", after: response.headers.get("x-after-cursor") ?? "" })
    })

    if (!current()) return null
    notify(HistoryStatus.Ready)

    return events
  } catch (error) {
    if (!current()) return null
    notify(HistoryStatus.Error)
    const code = error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED

    if (
      [
        ErrorCode.NETWORK_UNAVAILABLE,
        ErrorCode.REQUEST_TIMEOUT,
        ErrorCode.SERVICE_UNAVAILABLE,
        ErrorCode.REQUEST_FAILED,
        ErrorCode.INTERNAL_ERROR,
      ].some((candidate) => candidate === code)
    )
      throw new Error(ErrorCode.HISTORY_RELOAD_FAILED, { cause: error })
    throw error
  }
}

async function restoreSessionHistory(
  history: Promise<EventEnvelope[] | null>,
  current: () => boolean,
  publish: (frame: ServerFrame) => void,
  batch?: (events: EventEnvelope[]) => void,
) {
  try {
    const events = await history

    if (events && current()) {
      if (batch) batch(events)
      else for (const event of events) publish({ type: FrameType.Event, event })
    }
  } catch {
    if (current()) publish({ type: FrameType.Error, code: ErrorCode.HISTORY_RELOAD_FAILED })
  }
}

/** What the latest snapshot says about history identity: its event stream and each session's generation. */
export class HistoryStream {
  private snapshot: { deviceId: string; streamId: string } | null = null
  private generations = new Map<string, string>()

  generation(sessionId: string) {
    return this.generations.get(sessionId)
  }

  /** Records the snapshot and reports whether the device's event stream changed since the previous one. */
  changed(frame: Extract<ServerFrame, { type: typeof FrameType.Snapshot }>) {
    const previous = this.snapshot

    this.snapshot = { deviceId: frame.deviceId, streamId: frame.snapshot.cursor.streamId }
    for (const session of frame.snapshot.sessions) this.generations.set(session.id, session.generation)

    return previous !== null && previous.deviceId === frame.deviceId && previous.streamId !== this.snapshot.streamId
  }
}

export function restoreHistoryWindow(
  sessionId: string,
  history: Promise<EventEnvelope[] | null>,
  current: () => boolean,
  handlers: Pick<TransportHandlers, "onFrame" | "onHistory">,
) {
  return restoreSessionHistory(
    history,
    current,
    (frame) => handlers.onFrame(frame),
    handlers.onHistory ? (events) => handlers.onHistory!(sessionId, events) : undefined,
  )
}
