import { useEffect, useMemo, useSyncExternalStore } from "react"
import { ErrorCode } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { foldToolResults } from "@/pages/session/lib/subagent-history"
import { SubagentTranscript } from "./subagent-transcript"

export interface SubagentHistoryOptions {
  sessionId: string
  agentId: string
  /** The transcript can still grow and the session is observed: poll while the view is open and visible. */
  live: boolean
  /** Changes when the session's entry for this subagent changes; resumes a transcript that was unavailable. */
  revision: number
}

/**
 * The read-only transcript window of one subagent view. A new session or subagent gets a new window, so responses for
 * the previous one never reach it (the view is also remounted per generation); its items never enter the parent feed.
 */
export function useSubagentHistory({ sessionId, agentId, live, revision }: SubagentHistoryOptions) {
  const runtime = useRuntime()

  const transcript = useMemo(
    () =>
      new SubagentTranscript(async (direction, edge) => {
        const lease = runtime.current()
        const client = lease?.client

        if (!client?.subagentHistory) throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE)
        const events = await client.subagentHistory(sessionId, agentId, direction, edge)

        return runtime.isCurrent(lease) ? events : null
      }, document),
    [runtime, sessionId, agentId],
  )

  useEffect(() => {
    transcript.start(live)

    return () => transcript.stop()
  }, [transcript, live])

  useEffect(() => {
    transcript.resume()
  }, [transcript, revision])

  const state = useSyncExternalStore(transcript.subscribe, transcript.getSnapshot)
  const messages = useMemo(() => foldToolResults(state.messages), [state.messages])

  return { status: state.status, error: state.error, messages, page: transcript.page, retry: transcript.retry }
}
