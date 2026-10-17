import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent, within } from "storybook/test"
import { Language, ThemePreference } from "@protocol"
import { desktopConnections, mixedDesktopConnections } from "@storybook-fixtures/page-states"
import { DEVICE_ACCESS_IDS } from "../config/test-ids"
import { DeviceAccess } from "./device-access"

const meta = {
  component: DeviceAccess,
  args: { devices: [{ id: "fixture-mac", last_seen_at: "1700000000000" }], connectors: [], revoke: () => {} },
} satisfies Meta<typeof DeviceAccess>

export default meta
export const Connected: StoryObj<typeof meta> = {}

export const GroupedConnections: StoryObj<typeof meta> = {
  args: { connectors: desktopConnections },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId(DEVICE_ACCESS_IDS.toggle))
  },
}

export const MixedStates: StoryObj<typeof meta> = {
  ...GroupedConnections,
  args: { connectors: mixedDesktopConnections },
}

export const English: StoryObj<typeof meta> = { ...MixedStates, globals: { language: Language.En } }
export const Dark: StoryObj<typeof meta> = { ...MixedStates, globals: { theme: ThemePreference.Dark } }
