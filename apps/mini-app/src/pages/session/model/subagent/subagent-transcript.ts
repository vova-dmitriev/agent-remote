import { ErrorCode, HistoryDirection, type EventEnvelope, type HistoryMessage, type HistoryNavigationDirection } from "@protocol"
import {
  SUBAGENT_POLL_BACKOFF_MAX_MS,
  SUBAGENT_POLL_INTERVAL_MS,
  SUBAGENT_UNAVAILABLE_CODES,
  SubagentHistoryStatus,
} from "@/pages/session/config/subagent"
import { mergeSubagentPage, oldestCursor } from "@/pages/session/lib/subagent-history"
import { SubagentPoller, type VisibilitySource } from "./subagent-poller"

/** One page of the subagent's transcript; null when the response is no longer current. Errors carry the code as message. */
export type SubagentRead = (direction: HistoryNavigationDirection, edge?: string) => Promise<EventEnvelope[] | null>

export interface SubagentTranscriptState {
  status: SubagentHistoryStatus
  messages: HistoryMessage[]
  /** Error code of a failed first read. */
  error: string
}

/**
 * The transcript window of one subagent view (one instance per session, subagent and generation).
 * Reads run one at a time; a poll is skipped while another read is pending. After stop, responses are ignored.
 * Consecutive failures back off exponentially; an unavailable transcript stops polling until retry or resume.
 */
export class SubagentTranscript {
  private state: SubagentTranscriptState = { status: SubagentHistoryStatus.Loading, messages: [], error: "" }
  private listeners = new Set<() => void>()
  private poller: SubagentPoller | null = null
  private queue: Promise<void> = Promise.resolve()
  private pending = 0
  private epoch = 0
  private live = false
  private failures = 0
  private halted = false

  constructor(
    private readonly read: SubagentRead,
    private readonly visibility: VisibilitySource,
  ) {}

  getSnapshot = () => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Reads the latest page now and keeps polling while `live`. */
  start(live: boolean) {
    this.stop()
    this.live = live
    this.failures = 0
    this.halted = false
    this.poller = new SubagentPoller({ refresh: this.refresh, delay: this.delay, visibility: this.visibility })
    this.poller.start()
  }

  stop() {
    ++this.epoch
    this.poller?.stop()
    this.poller = null
  }

  /** User retry after an unavailable or failed transcript. */
  retry = () => {
    if (!this.poller) return
    if (!this.state.messages.length) this.set({ ...this.state, status: SubagentHistoryStatus.Loading, error: "" })
    this.start(this.live)
  }

  /** The subagent list changed: an unavailable transcript may exist now. */
  resume() {
    if (this.halted && this.poller) this.start(this.live)
  }

  /** Feed paging: earlier items continue from the oldest loaded one; latest re-reads the tail. */
  page = async (direction: HistoryNavigationDirection) => {
    if (direction === HistoryDirection.Before) await this.enqueue(HistoryDirection.Before, oldestCursor(this.state.messages))
    else if (direction === HistoryDirection.Latest) await this.enqueue(HistoryDirection.Latest)
  }

  private refresh = () => (this.pending ? Promise.resolve() : this.enqueue(HistoryDirection.Latest))

  private delay = () => {
    if (!this.live || this.halted) return null

    return this.failures
      ? Math.min(SUBAGENT_POLL_INTERVAL_MS * 2 ** this.failures, SUBAGENT_POLL_BACKOFF_MAX_MS)
      : SUBAGENT_POLL_INTERVAL_MS
  }

  private enqueue(direction: HistoryNavigationDirection, edge?: string) {
    const epoch = this.epoch

    ++this.pending

    const task = this.queue.then(() => this.load(direction, edge, epoch)).finally(() => --this.pending)

    this.queue = task

    return task
  }

  private async load(direction: HistoryNavigationDirection, edge: string | undefined, epoch: number) {
    if (epoch !== this.epoch) return

    try {
      const events = await this.read(direction, edge)

      if (epoch !== this.epoch || !events) return
      this.failures = 0
      this.set({ status: SubagentHistoryStatus.Ready, error: "", messages: mergeSubagentPage(this.state.messages, events, direction) })
    } catch (error) {
      if (epoch !== this.epoch) return
      const code = error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED
      const unavailable = SUBAGENT_UNAVAILABLE_CODES.some((candidate) => candidate === code)

      if (unavailable) this.halted = true
      else ++this.failures

      // Items already shown stay; a failed read only replaces the view before the first page arrives.
      if (!this.state.messages.length)
        this.set({ ...this.state, status: unavailable ? SubagentHistoryStatus.Unavailable : SubagentHistoryStatus.Failed, error: code })
    }
  }

  private set(state: SubagentTranscriptState) {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}
