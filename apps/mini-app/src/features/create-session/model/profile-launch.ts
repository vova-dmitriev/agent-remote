import {
  AgentProvider,
  CapabilitySupport,
  ProfileStatus,
  type ExecutionLaunchSelection,
  type ExecutionProfileSummary,
  type ProfileList,
  type ReasoningEffort,
} from "@protocol"

export interface ProfileExecution {
  selection: ExecutionLaunchSelection
  expectedVersion: number
}

export interface ProfileLaunchResolution {
  profile: ExecutionProfileSummary | undefined
  profileAvailable: boolean
  execution: ProfileExecution | null
}

export function selectableProfiles(data: ProfileList | undefined, provider: AgentProvider, online: boolean, refreshing: boolean) {
  if (!data?.available || !online || refreshing) return []

  return data.profiles.filter(
    (profile) =>
      profile.provider === provider &&
      profile.status === ProfileStatus.Ready &&
      profile.identity !== null &&
      profile.capabilities.isolation === CapabilitySupport.Supported &&
      profile.capabilities.createSession,
  )
}

export function buildProfileExecution(
  profile: ExecutionProfileSummary,
  model: string,
  effort: ReasoningEffort | undefined,
): ProfileExecution | null {
  if (
    profile.status !== ProfileStatus.Ready ||
    profile.identity === null ||
    profile.capabilities.isolation !== CapabilitySupport.Supported ||
    !profile.capabilities.createSession
  )
    return null

  const offeredModel = profile.models.find((entry) => entry.id === model)

  if (!offeredModel || (effort !== undefined && !offeredModel.efforts.includes(effort))) return null

  return {
    selection: { profileId: profile.id, provider: profile.provider, model, ...(effort ? { effort } : {}) },
    expectedVersion: profile.version,
  }
}

export function resolveProfileLaunch(
  data: ProfileList | undefined,
  provider: AgentProvider,
  profileId: string,
  model: string,
  effort: ReasoningEffort | "",
  online: boolean,
  refreshing: boolean,
): ProfileLaunchResolution {
  const profile = data?.profiles.find((entry) => entry.id === profileId)

  const profileAvailable =
    profileId !== "" && selectableProfiles(data, provider, online, refreshing).some((entry) => entry.id === profileId)

  const selectedModel = profile?.models.find((entry) => entry.id === model)

  const execution =
    profile && profileAvailable && selectedModel ? buildProfileExecution(profile, selectedModel.id, effort || undefined) : null

  return { profile, profileAvailable, execution }
}
