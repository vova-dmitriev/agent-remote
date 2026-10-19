import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { Language, ThemePreference } from "@protocol"
import { DesktopLayoutStory, DESKTOP_LAYOUT_IDS } from "@storybook-components/desktop/desktop-layout-story"
import { manySidebarSessions } from "@storybook-fixtures/sidebar-sessions"
import { SESSION_SIDEBAR_IDS } from "../config/test-ids"

/** Design spike: desktop mode (≥ 960 px) with a Codex-style session sidebar. Synthetic fixtures only. */
const meta = {
  component: DesktopLayoutStory,
  title: "Widgets/Session sidebar",
  globals: { language: Language.En, theme: ThemePreference.Light },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DesktopLayoutStory>

export default meta
type Story = StoryObj<typeof meta>
export const DesktopLayout: Story = {}
export const Dark: Story = { globals: { theme: ThemePreference.Dark } }
export const Russian: Story = { globals: { language: Language.Ru } }

export const Searching: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByTestId(SESSION_SIDEBAR_IDS.search), "codex")
  },
}

export const NoResults: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByTestId(SESSION_SIDEBAR_IDS.search), "zzq-nothing-here")
  },
}

export const ManySessions: Story = { args: { sessions: manySidebarSessions, initialActiveId: manySidebarSessions[30]!.id } }
export const Collapsed: Story = { args: { initialCollapsed: true } }
export const NothingSelected: Story = { args: { initialActiveId: null } }

export const KeyboardNavigation: Story = {
  play: async ({ canvas }) => {
    canvas.getByTestId(SESSION_SIDEBAR_IDS.list).focus()
    await userEvent.keyboard("{ArrowDown}{ArrowDown}")
  },
}

export const SettingsMenuOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(DESKTOP_LAYOUT_IDS.settings))
  },
}
