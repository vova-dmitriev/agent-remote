import type { Meta, StoryObj } from "@storybook/react-vite"
import { Language, RuleScopeKind, ThemePreference } from "@protocol"
import { permission } from "@storybook-fixtures/session"
import { PermissionCard } from "./permission-card"

const meta = { component: PermissionCard, args: { permission, disabled: false, decide: () => {} } } satisfies Meta<typeof PermissionCard>

export default meta
export const Pending: StoryObj<typeof meta> = {}
export const Expired: StoryObj<typeof meta> = { args: { permission: { ...permission, expiresAt: 1 } } }
export const Offline: StoryObj<typeof meta> = { args: { disabled: true } }

const ruleStop = {
  ...permission,
  toolName: "Bash",
  input: { command: 'docker exec synthetic-db psql -c "DELETE FROM orders"' },
  expiresAt: Date.now() + 600_000,
  rule: { id: "ready-database", name: "Suspicious database queries", scope: RuleScopeKind.Project },
}

export const RuleStop: StoryObj<typeof meta> = { args: { permission: ruleStop } }
export const RuleStopDark: StoryObj<typeof meta> = { args: { permission: ruleStop }, globals: { theme: ThemePreference.Dark } }
export const RuleStopEnglish: StoryObj<typeof meta> = { args: { permission: ruleStop }, globals: { language: Language.En } }
