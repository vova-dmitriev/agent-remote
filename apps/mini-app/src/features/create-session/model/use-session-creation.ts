import { useState } from "react"
import { AgentProvider, BindingState, IntegrationState, SessionStatus, type Session } from "@protocol"
import type { ModelChoice, ProfileList, ProviderModels, ReasoningEffort } from "@protocol"
import { resolveProfileLaunch, selectableProfiles } from "./profile-launch"

export function useSessionCreation(
  sessions: Session[],
  data: ProfileList | undefined,
  online: boolean,
  refreshing: boolean,
  nativeModels: ProviderModels[] = [],
) {
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
  // The device's own sign-in offers its models in the snapshot; a profile lists its own.
  const native = profileId === ""
  const models = native ? nativeModels.find((entry) => entry.provider === provider)?.models : launch.profile?.models
  const selectedModel = models?.find((entry) => entry.id === modelId)

  const modelChoice: ModelChoice | undefined =
    native && selectedModel ? { model: selectedModel.id, ...(effort ? { effort } : {}) } : undefined

  function setProvider(value: AgentProvider) {
    updateProvider(value)
    setModelId("")
    setEffort("")
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
    native,
    /** The models the form offers; none hides the model fields (a device that lists none for its own sign-in). */
    fieldModels: native && !models?.length ? undefined : (models ?? []),
    modelsAvailable: native || (launch.profileAvailable && !!launch.profile),
    selectedModel,
    modelChoice,
    profileId,
    setLaunchProfile,
    modelId,
    setModel: setModel,
    effort,
    setEffort,
    execution: launch.execution,
  }
}
