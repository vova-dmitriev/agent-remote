import { AgentProvider, CapabilitySupport, ProfileStatus, ReasoningEffort, ProfileAuthMode } from "@protocol"
import { describe, expect, it } from "vitest"
import { buildProfileExecution, resolveProfileLaunch, selectableProfiles } from "../src/features/create-session"
import type { ExecutionProfileSummary, ProfileList } from "@protocol"

const profile = (overrides: Partial<ExecutionProfileSummary> = {}): ExecutionProfileSummary => ({
  id: "550e8400-e29b-41d4-a716-446655440000",
  ownerId: "owner",
  deviceId: "device",
  provider: AgentProvider.Codex,
  authMode: ProfileAuthMode.Subscription,
  label: "Synthetic account",
  status: ProfileStatus.Ready,
  identity: { accountRef: "account", verifiedAt: 1 },
  capabilities: { isolation: CapabilitySupport.Supported, createSession: true, contextSeed: false, resume: false, quota: false },
  models: [{ id: "gpt-synthetic", efforts: [ReasoningEffort.High] }],
  version: 7,
  updatedAt: 1,
  ...overrides,
})

const list: ProfileList = {
  available: true,
  observedAt: 1,
  profiles: [profile()],
  operations: [],
  defaults: { [AgentProvider.Claude]: null, [AgentProvider.Codex]: null },
}

describe("new session profile selection", () => {
  it("offers only fresh ready verified profiles for the selected provider", () => {
    const unavailable = profile({ id: "550e8400-e29b-41d4-a716-446655440001", status: ProfileStatus.NeedsAuthentication })
    const result = selectableProfiles({ ...list, profiles: [...list.profiles, unavailable] }, AgentProvider.Codex, true, false)

    expect(result.map((entry) => entry.id)).toEqual([profile().id])
    expect(selectableProfiles(list, AgentProvider.Claude, true, false)).toEqual([])
    expect(selectableProfiles(list, AgentProvider.Codex, false, false)).toEqual([])
    expect(selectableProfiles(list, AgentProvider.Codex, true, true)).toEqual([])
    expect(selectableProfiles({ ...list, available: false }, AgentProvider.Codex, true, false)).toEqual([])
    expect(selectableProfiles({ ...list, profiles: [profile({ identity: null })] }, AgentProvider.Codex, true, false)).toEqual([])

    expect(
      selectableProfiles(
        { ...list, profiles: [profile({ capabilities: { ...profile().capabilities, isolation: CapabilitySupport.Unknown } })] },
        AgentProvider.Codex,
        true,
        false,
      ),
    ).toEqual([])
  })

  it("builds an execution envelope only from offered model and effort values", () => {
    const selected = profile()

    expect(buildProfileExecution(selected, "gpt-synthetic", ReasoningEffort.High)).toEqual({
      selection: { profileId: selected.id, provider: AgentProvider.Codex, model: "gpt-synthetic", effort: ReasoningEffort.High },
      expectedVersion: 7,
    })

    expect(buildProfileExecution(selected, "unoffered", undefined)).toBeNull()
    expect(buildProfileExecution(selected, "gpt-synthetic", ReasoningEffort.Low)).toBeNull()
  })

  it("preserves a selected profile through disconnect and restores the same launch after reconnect", () => {
    const selected = profile()
    const resolution = resolveProfileLaunch(list, AgentProvider.Codex, selected.id, "gpt-synthetic", ReasoningEffort.High, false, true)
    const reconnected = resolveProfileLaunch(list, AgentProvider.Codex, selected.id, "gpt-synthetic", ReasoningEffort.High, true, false)

    expect(resolution.profile?.id).toBe(selected.id)
    expect(resolution.profileAvailable).toBe(false)
    expect(resolution.execution).toBeNull()
    expect(reconnected.profile?.id).toBe(selected.id)

    expect(reconnected.execution?.selection).toEqual({
      profileId: selected.id,
      provider: AgentProvider.Codex,
      model: "gpt-synthetic",
      effort: ReasoningEffort.High,
    })
  })
})
