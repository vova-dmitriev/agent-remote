import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { Language } from "@protocol"
import { apiProfile } from "@storybook-fixtures/accounts/profiles"
import { PROFILE_ENROLL_IDS } from "@/pages/accounts/config/enrollment/test-ids"
import { ProfileEnrollment } from "./profile-enrollment"

const meta = {
  component: ProfileEnrollment,
  globals: { language: Language.En },
  args: { profile: apiProfile, disabled: false, perform: async () => null },
} satisfies Meta<typeof ProfileEnrollment>

export default meta
export const Collapsed: StoryObj<typeof meta> = {}
export const FingerprintVerification: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(PROFILE_ENROLL_IDS.toggle))
    await userEvent.type(canvas.getByTestId(PROFILE_ENROLL_IDS.pin), "a".repeat(64))
  },
}
export const Offline: StoryObj<typeof meta> = { args: { disabled: true } }
