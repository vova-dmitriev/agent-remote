import { useState } from "react"
import { AgentProvider, BindingState, IntegrationState, SessionStatus, type Session } from "@protocol"

export function useSessionCreation(sessions: Session[]) {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<AgentProvider>(AgentProvider.Codex)
  const [projectId, setProjectId] = useState("")
  const seen = new Set<string>()

  const projects = sessions.filter((session) => {
    if (
      !session.cwd ||
      seen.has(session.cwd) ||
      !session.capabilities.createSession ||
      session.binding !== BindingState.Verified ||
      session.integrationState !== IntegrationState.Ready ||
      session.status === SessionStatus.Ended
    )
      return false
    seen.add(session.cwd)

    return true
  })

  const selected = projects.find((session) => session.id === projectId) ?? projects[0]

  return { open, setOpen, provider, setProvider, projects, selected, setProjectId }
}
