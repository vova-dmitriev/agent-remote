import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { Language, ProfileAuthMode } from "@protocol"
import { PROFILE_MANAGE_IDS } from "@/pages/accounts/config/management/test-ids"
import { ProfileCreateForm } from "./profile-create-form"

const meta = {
  component: ProfileCreateForm,
  globals: { language: Language.En },
  args: { disabled: false, submit: async () => null },
} satisfies Meta<typeof ProfileCreateForm>

export default meta
export const Subscription: StoryObj<typeof meta> = {}
export const ApiKey: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByTestId(PROFILE_MANAGE_IDS.label), "Development API")
    await userEvent.selectOptions(canvas.getByTestId(PROFILE_MANAGE_IDS.authMode), ProfileAuthMode.ApiKey)
  },
}
export const Offline: StoryObj<typeof meta> = { args: { disabled: true } }
