import {
  AgentProvider,
  CapabilitySupport,
  ProfileAuthMode,
  ProfileOperationPhase,
  ProfileAction,
  ProfileStatus,
  ReasoningEffort,
  type ExecutionProfileSummary,
  type ProfileList,
  type ProfileOperation,
} from "@protocol"

export const personalProfile: ExecutionProfileSummary = {
  id: "ba000000-0000-4000-8000-000000000001",
  ownerId: "synthetic-owner",
  deviceId: "synthetic-mac",
  provider: AgentProvider.Codex,
  authMode: ProfileAuthMode.Subscription,
  label: "Personal OpenAI",
  status: ProfileStatus.Ready,
  identity: {
    accountRef: "synthetic-personal-account",
    accountLabel: "personal@example.invalid",
    workspaceRef: "synthetic-personal-workspace",
    verifiedAt: 1700000000000,
  },
  capabilities: { isolation: CapabilitySupport.Supported, createSession: true, contextSeed: true, resume: false, quota: false },
  models: [{ id: "synthetic-model", efforts: [ReasoningEffort.Medium] }],
  version: 3,
  updatedAt: 1700000000000,
}

const workProfile: ExecutionProfileSummary = {
  ...personalProfile,
  id: "ba000000-0000-4000-8000-000000000002",
  label: "Work OpenAI",
  identity: {
    accountRef: "synthetic-work-account",
    accountLabel: "work@example.invalid",
    workspaceRef: "synthetic-work-workspace",
    verifiedAt: 1700000000000,
  },
}

export const apiProfile: ExecutionProfileSummary = {
  ...personalProfile,
  id: "ba000000-0000-4000-8000-000000000003",
  authMode: ProfileAuthMode.ApiKey,
  label: "Development API",
  identity: { accountRef: "fixture-demo-account", verifiedAt: 1700000000000 },
}

export const waitingProfile: ExecutionProfileSummary = {
  ...personalProfile,
  status: ProfileStatus.NeedsAuthentication,
  identity: null,
  models: [],
  capabilities: { isolation: CapabilitySupport.Unknown, createSession: false, contextSeed: false, resume: false, quota: false },
}

export const pendingProfileOperation: ProfileOperation = {
  id: "bb000000-0000-4000-8000-000000000001",
  ownerId: personalProfile.ownerId,
  deviceId: personalProfile.deviceId,
  profileId: personalProfile.id,
  action: ProfileAction.SignIn,
  phase: ProfileOperationPhase.AwaitingAuthentication,
  profileVersion: 3,
  version: 2,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

export const accountsFixture: ProfileList = {
  available: true,
  observedAt: 1700000000000,
  profiles: [personalProfile, workProfile, apiProfile],
  operations: [],
  defaults: { [AgentProvider.Codex]: personalProfile.id, [AgentProvider.Claude]: null },
}
