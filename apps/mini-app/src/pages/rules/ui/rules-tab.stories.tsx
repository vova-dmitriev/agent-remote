import type { Meta, StoryObj } from "@storybook/react-vite"
import { Language, ReadyRule, RuleScopeKind, ThemePreference } from "@protocol"
import { RulesTab } from "./rules-tab"

const own = {
  id: "own-1",
  name: "Prod database",
  ready: null,
  sentence: "ask before any query to the prod database",
  patterns: ["prod-db"],
}

const inherited = { id: "ready-database", name: "Suspicious database queries", ready: ReadyRule.Database, sentence: null, patterns: ["x"] }

const project = {
  id: "/work/synthetic-app",
  label: "synthetic-app",
  scope: { kind: RuleScopeKind.Project, key: "/work/synthetic-app" },
  bypass: false,
  ready: [ReadyRule.Database, ReadyRule.ForcePush],
  own: [own],
  inherited: [],
  allowed: ['psql -c "DELETE FROM synthetic_tmp"'],
}

const session = {
  ...project,
  id: "session",
  label: "Сессия: ETC-1374",
  scope: { kind: RuleScopeKind.Session, key: "synthetic-session" },
  bypass: true,
  ready: [ReadyRule.ForcePush],
  own: [],
  inherited: [inherited],
  allowed: [],
}

const meta = {
  component: RulesTab,
  args: { tab: project, busy: false, onToggle: () => {}, onRemove: () => {}, onForget: () => {} },
} satisfies Meta<typeof RulesTab>

export default meta
type Story = StoryObj<typeof meta>

export const Project: Story = {}
export const SessionInBypass: Story = { args: { tab: session } }
export const Empty: Story = { args: { tab: { ...project, ready: [], own: [], allowed: [] } } }
export const Dark: Story = { globals: { theme: ThemePreference.Dark } }
export const English: Story = { args: { tab: session }, globals: { language: Language.En } }
