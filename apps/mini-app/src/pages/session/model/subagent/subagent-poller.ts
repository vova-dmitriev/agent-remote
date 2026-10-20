export type VisibilitySource = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">

const VisibilityEvent = "visibilitychange"
const Visible: DocumentVisibilityState = "visible"

export interface SubagentPollerOptions {
  /** Reads the transcript tail once; failures are the caller's to report. */
  refresh: () => Promise<void>
  /** Wait before the next read, or null when the transcript is not to be polled (finished, unavailable). */
  delay: () => number | null
  visibility: VisibilitySource
}

/**
 * Re-reads an open subagent transcript: once on start, then after each delay while one is given and the page is visible.
 * Hiding the page pauses the timer and showing it reads at once; stop ends the cycle and ignores reads in flight.
 */
export class SubagentPoller {
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private stopped = false

  constructor(private readonly options: SubagentPollerOptions) {}

  start() {
    this.options.visibility.addEventListener(VisibilityEvent, this.onVisibility)
    void this.run()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.options.visibility.removeEventListener(VisibilityEvent, this.onVisibility)
  }

  private visible() {
    return this.options.visibility.visibilityState === Visible
  }

  private onVisibility = () => {
    if (this.stopped) return

    if (!this.visible()) {
      clearTimeout(this.timer)
      this.timer = undefined

      return
    }

    if (this.options.delay() !== null && !this.running && this.timer === undefined) void this.run()
  }

  private async run() {
    this.timer = undefined
    if (this.stopped) return
    this.running = true

    try {
      await this.options.refresh()
    } catch {
      // The caller reports read failures and lengthens the delay.
    } finally {
      this.running = false
    }

    const delay = this.options.delay()

    if (!this.stopped && delay !== null && this.visible()) this.timer = setTimeout(() => void this.run(), delay)
  }
}
