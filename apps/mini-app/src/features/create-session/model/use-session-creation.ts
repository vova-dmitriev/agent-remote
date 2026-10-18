import { useState } from "react"
import { AgentProvider, BindingState, IntegrationState, SessionStatus, type Session } from "@protocol"
import type { ProfileList, ReasoningEffort } from "@protocol"
import { resolveProfileLaunch, selectableProfiles } from "./profile-launch"

export function useSessionCreation(sessions: Session[], data: ProfileList | undefined, online: boolean, refreshing: boolean) {
  const [open, setOpen] = useState(false)
  const [provider, updateProvider] = useState<AgentProvider>(AgentProvider.Codex)
  const [projectId, setProjectId] = useState("")
  const [profileId, setProfileId] = useState("")
  const [modelId, setModelId] = useState("")
  const [effort, setEffort] = useState<ReasoningEffort | "">("")
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
  const profiles = selectableProfiles(data, provider, online, refreshing)
  const launch = resolveProfileLaunch(data, provider, profileId, modelId, effort, online, refreshing)

  function setProvider(value: AgentProvider) {
    updateProvider(value)
  }

  function setLaunchProfile(value: string) {
    setProfileId(value)
    setModelId("")
    setEffort("")
  }

  function setModel(value: string) {
    setModelId(value)
    setEffort("")
  }

  return {
    open,
    setOpen,
    provider,
    setProvider,
    projects,
    selected,
    setProjectId,
    profiles,
    profile: launch.profile,
    profileAvailable: launch.profileAvailable,
    selectedModel: launch.profile?.models.find((entry) => entry.id === modelId),
    profileId,
    setLaunchProfile,
    modelId,
    setModel: setModel,
    effort,
    setEffort,
    execution: launch.execution,
  }
}
