import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { ConnectionStatus, Language, ThemePreference } from "@protocol"
import { SHELL_IDS } from "../config/test-ids"
import { DesktopHeader } from "./desktop-header"

const meta = {
  component: DesktopHeader,
  title: "Widgets/Desktop header",
  globals: { language: Language.En },
  parameters: { layout: "fullscreen" },
  args: {
    connection: ConnectionStatus.Online,
    sidebarCollapsed: false,
    onToggleSidebar: () => {},
    onHome: () => {},
    onAccounts: () => {},
    onLogout: () => {},
  },
} satisfies Meta<typeof DesktopHeader>

export default meta
type Story = StoryObj<typeof meta>
export const Online: Story = {}
export const Offline: Story = { args: { connection: ConnectionStatus.Offline } }
export const SidebarCollapsed: Story = { args: { sidebarCollapsed: true } }
export const Dark: Story = { globals: { theme: ThemePreference.Dark } }
export const Russian: Story = { globals: { language: Language.Ru } }

export const SettingsMenuOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(SHELL_IDS.settings))
  },
}
