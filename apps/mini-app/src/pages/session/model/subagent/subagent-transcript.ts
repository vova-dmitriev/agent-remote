import { ErrorCode, HistoryDirection, type EventEnvelope, type HistoryMessage, type HistoryNavigationDirection } from "@protocol"
import {
  SUBAGENT_POLL_BACKOFF_MAX_MS,
  SUBAGENT_POLL_INTERVAL_MS,
  SUBAGENT_UNAVAILABLE_CODES,
  SubagentHistoryStatus,
} from "@/pages/session/config/subagent"
import { mergeSubagentPage, oldestCursor } from "@/pages/session/lib/history/subagent-history"
import { HistoryPageOutcome, historyPageOutcome } from "@/entities/session"
import type { HistoryPageSkip } from "@/shared/api"
import { SubagentPoller, type VisibilitySource } from "./subagent-poller"

/**
 * One page of the subagent's transcript, a skip reason (busy, stale or exhausted edge) or null when the response is
 * no longer current. Errors carry the code as message.
 */
export type SubagentRead = (direction: HistoryNavigationDirection, edge?: string) => Promise<EventEnvelope[] | HistoryPageSkip | null>

export interface SubagentTranscriptState {
  status: SubagentHistoryStatus
  messages: HistoryMessage[]
  /** Error code of a failed first read. */
  error: string
}

/**
 * The transcript window of one subagent view (one instance per session, subagent and generation).
 * Reads run one at a time; a poll is skipped while another read of the current start is pending (a restart's first
 * read queues behind a discarded one). After stop, responses are ignored.
 * Consecutive failures back off exponentially; an unavailable transcript stops polling until retry or resume.
 */
export class SubagentTranscript {
  private state: SubagentTranscriptState = { status: SubagentHistoryStatus.Loading, messages: [], error: "" }
  private listeners = new Set<() => void>()
  private poller: SubagentPoller | null = null
  private queue: Promise<unknown> = Promise.resolve()
  /** Reads queued since the last start; reads of an earlier start never block a poll. */
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
    this.pending = 0
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

  /**
   * Feed paging: earlier items continue from the oldest loaded one; latest re-reads the tail; newer items arrive by polling.
   * The outcome lets the feed mark an edge exhausted only after a loaded or declined page, as for the parent feed.
   */
  page = async (direction: HistoryNavigationDirection): Promise<HistoryPageOutcome | void> => {
    if (direction === HistoryDirection.Before) return this.enqueue(HistoryDirection.Before, oldestCursor(this.state.messages))
    if (direction === HistoryDirection.Latest) return this.enqueue(HistoryDirection.Latest)
  }

  private refresh = async () => {
    if (!this.pending) await this.enqueue(HistoryDirection.Latest)
  }

  private delay = () => {
    if (!this.live || this.halted) return null

    return this.failures
      ? Math.min(SUBAGENT_POLL_INTERVAL_MS * 2 ** this.failures, SUBAGENT_POLL_BACKOFF_MAX_MS)
      : SUBAGENT_POLL_INTERVAL_MS
  }

  private enqueue(direction: HistoryNavigationDirection, edge?: string) {
    const epoch = this.epoch

    ++this.pending

    const task = this.queue
      .then(() => this.load(direction, edge, epoch))
      .finally(() => {
        if (epoch === this.epoch) --this.pending
      })

    this.queue = task

    return task
  }

  private async load(direction: HistoryNavigationDirection, edge: string | undefined, epoch: number): Promise<HistoryPageOutcome> {
    if (epoch !== this.epoch) return HistoryPageOutcome.Stale

    try {
      const result = await this.read(direction, edge)

      if (epoch !== this.epoch) return HistoryPageOutcome.Stale
      // A skip (busy, stale, exhausted edge) or a stale latest read changes nothing.
      if (!Array.isArray(result)) return historyPageOutcome(result)
      this.failures = 0
      this.set({ status: SubagentHistoryStatus.Ready, error: "", messages: mergeSubagentPage(this.state.messages, result, direction) })

      return HistoryPageOutcome.Loaded
    } catch (error) {
      if (epoch !== this.epoch) return HistoryPageOutcome.Stale
      const code = error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED
      const unavailable = SUBAGENT_UNAVAILABLE_CODES.some((candidate) => candidate === code)

      if (unavailable) this.halted = true
      else ++this.failures

      // Items already shown stay; a failed read only replaces the view before the first page arrives.
      if (!this.state.messages.length)
        this.set({ ...this.state, status: unavailable ? SubagentHistoryStatus.Unavailable : SubagentHistoryStatus.Failed, error: code })

      return HistoryPageOutcome.Failed
    }
  }

  private set(state: SubagentTranscriptState) {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}
