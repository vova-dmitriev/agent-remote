import { useState } from "react"
import { useRuntime } from "@/shared/lib/runtime"

interface OpenSubagent {
  sessionId: string
  agentId: string
}

/** The subagent open over the selected session; selecting another session (or none) closes it. */
export function useSubagentView(selectedId: string | null) {
  const runtime = useRuntime()
  const [open, setOpen] = useState<OpenSubagent | null>(null)
  const [owner, setOwner] = useState(selectedId)

  if (owner !== selectedId) {
    setOwner(selectedId)
    setOpen(null)
  }

  return {
    /** The host's client can read subagent transcripts (the session's own capability is checked where rows render). */
    supported: !!runtime.client?.subagentHistory,
    agentId: open && open.sessionId === selectedId ? open.agentId : null,
    open: (sessionId: string, agentId: string) => setOpen({ sessionId, agentId }),
    close: () => setOpen(null),
  }
}
