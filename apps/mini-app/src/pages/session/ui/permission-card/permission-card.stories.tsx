import type { Meta, StoryObj } from "@storybook/react-vite"
import { permission } from "@storybook-fixtures/session"
import { PermissionCard } from "./permission-card"

const meta = { component: PermissionCard, args: { permission, disabled: false, decide: () => {} } } satisfies Meta<typeof PermissionCard>

export default meta
export const Pending: StoryObj<typeof meta> = {}
export const Expired: StoryObj<typeof meta> = { args: { permission: { ...permission, expiresAt: 1 } } }
export const Offline: StoryObj<typeof meta> = { args: { disabled: true } }
