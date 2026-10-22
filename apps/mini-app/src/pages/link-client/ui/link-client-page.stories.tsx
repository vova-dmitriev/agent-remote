import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { LINK_CLIENT_IDS } from "../config/test-ids"
import { LinkClientPage } from "./link-client-page"

const meta = {
  component: LinkClientPage,
  args: { server: "https://relay.invalid", onLinked: () => undefined, onUseCompanion: () => undefined },
} satisfies Meta<typeof LinkClientPage>

export default meta
export const Empty: StoryObj<typeof meta> = {}
export const Typed: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByTestId(LINK_CLIENT_IDS.code), "ABCD-EFGH")
  },
}
