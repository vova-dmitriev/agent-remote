import { useState } from "react"
import { AgentProvider, ErrorCode, type Session } from "@protocol"
import type { ModelChoice, ProfileList, ProviderModels, ReasoningEffort } from "@protocol"
import { projectChoice } from "./project-choice"
import { resolveProfileLaunch, selectableProfiles, type ProfileExecution } from "./profile-launch"

type CreateSession = (session: Session, provider: AgentProvider, execution?: ProfileExecution, model?: ModelChoice) => void
type CreateInProject = (cwd: string, provider: AgentProvider, model?: ModelChoice) => Promise<unknown>

export function useSessionCreation(
  sessions: Session[],
  data: ProfileList | undefined,
  online: boolean,
  refreshing: boolean,
  nativeModels: ProviderModels[] = [],
  projectPaths: readonly string[] = [],
) {
  const [open, setOpen] = useState(false)
  const [provider, updateProvider] = useState<AgentProvider>(AgentProvider.Codex)
  const [projectId, setProjectId] = useState("")
  const [profileId, setProfileId] = useState("")
  const [modelId, setModelId] = useState("")
  const [effort, setEffort] = useState<ReasoningEffort | "">("")
  /** Why the device refused the last session in a project, as an error code. */
  const [error, setError] = useState("")
  const { projects, selected, selectedPath, projectOptions, projectValue, projectLabel } = projectChoice(sessions, projectPaths, projectId)
  const profiles = selectableProfiles(data, provider, online, refreshing)
  const launch = resolveProfileLaunch(data, provider, profileId, modelId, effort, online, refreshing)
  // The device's own sign-in offers its models in the snapshot; a profile lists its own.
  const native = profileId === ""
  const models = native ? nativeModels.find((entry) => entry.provider === provider)?.models : launch.profile?.models
  const selectedModel = models?.find((entry) => entry.id === modelId)

  const modelChoice: ModelChoice | undefined =
    native && selectedModel ? { model: selectedModel.id, ...(effort ? { effort } : {}) } : undefined

  /** Starts the session beside the chosen one, or in the chosen project through the device. */
  async function submit(create: CreateSession, createInProject: CreateInProject | undefined) {
    if (selected) {
      create(selected, provider, launch.execution ?? undefined, modelChoice)

      return
    }

    if (!selectedPath || !createInProject) return
    setError("")

    try {
      await createInProject(selectedPath, provider, modelChoice)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : ErrorCode.REQUEST_FAILED)
    }
  }

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
    selectedPath,
    setProjectId,
    projectOptions,
    projectValue,
    projectLabel,
    /** A project session runs on the device's own sign-in; a profile launch needs a session beside it. */
    ready: selectedPath ? native : native || (launch.profileAvailable && !!launch.execution),
    submit,
    error,
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
