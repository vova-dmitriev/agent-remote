import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { Language } from "@protocol"
import { personalProfile, pendingProfileOperation } from "@storybook-fixtures/accounts/profiles"
import { PROFILE_MANAGE_IDS } from "@/pages/accounts/config/management/test-ids"
import { ProfileActions } from "./profile-actions"

const meta = {
  component: ProfileActions,
  globals: { language: Language.En },
  args: { profile: personalProfile, disabled: false, preferred: true, run: async () => null },
} satisfies Meta<typeof ProfileActions>

export default meta
export const Connected: StoryObj<typeof meta> = {}
export const Rename: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(PROFILE_MANAGE_IDS.rename))
  },
}
export const PendingOperation: StoryObj<typeof meta> = { args: { operation: pendingProfileOperation } }
export const Busy: StoryObj<typeof meta> = { args: { disabled: true } }
