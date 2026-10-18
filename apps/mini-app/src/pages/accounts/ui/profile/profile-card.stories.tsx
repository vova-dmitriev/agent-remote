import type { Meta, StoryObj } from "@storybook/react-vite"
import { Language, ProfileStatus, ProfileOperationPhase, ErrorCode } from "@protocol"
import { personalProfile, apiProfile, waitingProfile, pendingProfileOperation } from "@storybook-fixtures/accounts/profiles"
import { ProfileCard } from "./profile-card"

const meta = {
  component: ProfileCard,
  globals: { language: Language.En },
  args: { profile: personalProfile, preferred: true },
} satisfies Meta<typeof ProfileCard>

export default meta
export const Subscription: StoryObj<typeof meta> = {}
export const ApiKey: StoryObj<typeof meta> = { args: { profile: apiProfile, preferred: false } }
export const SignInRequired: StoryObj<typeof meta> = { args: { profile: waitingProfile, preferred: false } }
export const Disabled: StoryObj<typeof meta> = {
  args: { profile: { ...personalProfile, status: ProfileStatus.Disabled }, preferred: false },
}
export const AwaitingAuthentication: StoryObj<typeof meta> = {
  args: { profile: waitingProfile, operation: pendingProfileOperation, preferred: false },
}
export const PendingRemoval: StoryObj<typeof meta> = {
  args: {
    profile: { ...personalProfile, status: ProfileStatus.Removing },
    operation: { ...pendingProfileOperation, phase: ProfileOperationPhase.Removing },
    preferred: false,
  },
}
export const UncertainEnrollment: StoryObj<typeof meta> = {
  args: {
    profile: waitingProfile,
    operation: { ...pendingProfileOperation, phase: ProfileOperationPhase.Unknown, code: ErrorCode.NETWORK_UNAVAILABLE },
    preferred: false,
  },
}
