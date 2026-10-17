import type { Meta, StoryObj } from "@storybook/react-vite"
import { ConnectionStatus, CommandStatus, ThemePreference, Language, ErrorCode } from "@protocol"
import { ApplicationShell } from "./application-shell"

const meta = {
  component: ApplicationShell,
  args: { connection: ConnectionStatus.Online, result: "", onHome: () => {}, onLogout: () => {}, children: "Synthetic page content" },
} satisfies Meta<typeof ApplicationShell>

export default meta
export const Online: StoryObj<typeof meta> = {}
export const Offline: StoryObj<typeof meta> = { args: { connection: ConnectionStatus.Offline } }
export const Connecting: StoryObj<typeof meta> = { args: { connection: ConnectionStatus.Connecting } }
export const Expired: StoryObj<typeof meta> = { args: { connection: ConnectionStatus.Expired } }
export const DeliveryReceipt: StoryObj<typeof meta> = { args: { result: CommandStatus.Dispatched } }
export const PairingConfirmation: StoryObj<typeof meta> = { args: { result: ErrorCode.PAIRING_CONFIRM_LOCAL } }
export const Dark: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Dark } }

export const English: StoryObj<typeof meta> = { globals: { language: Language.En } }

export const CompactSession: StoryObj<typeof meta> = { args: { compact: true } }
export const CompactSessionDark: StoryObj<typeof meta> = { args: { compact: true }, globals: { theme: ThemePreference.Dark } }
