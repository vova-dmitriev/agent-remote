import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { StoryPage } from "@storybook-fixtures/page"
import { ConnectionStatus, HistoryStatus, CommandStatus, SessionStatus, Language, ThemePreference, ErrorCode } from "@protocol"
import { ApplicationStory } from "@storybook-components/application-story"
import { codexDesktopSession, terminalSession, snapshot, permission } from "@storybook-fixtures/session"
import { sessionState } from "@storybook-fixtures/page-states"
import { COMMAND_IDS } from "@/features/send-command"

const meta = { component: ApplicationStory, parameters: { layout: "fullscreen" } } satisfies Meta<typeof ApplicationStory>

export default meta
type Story = StoryObj<typeof meta>

export const Sessions: Story = {}
export const SignInRequired: Story = { args: { page: StoryPage.SignIn, connection: ConnectionStatus.Expired } }
export const Connecting: Story = { args: { connection: ConnectionStatus.Connecting, sessionsProps: { loading: true } } }
export const ConnectedEmpty: Story = { args: { sessionsProps: { sessions: [] } } }
export const PairMac: Story = { args: { sessionsProps: { sessions: [], connected: false } } }
export const PairingConfirmation: Story = { args: { ...PairMac.args, result: ErrorCode.PAIRING_CONFIRM_LOCAL } }
export const PairingError: Story = { args: { ...PairMac.args, error: ErrorCode.PAIRING_UNAVAILABLE } }
export const SessionsOffline: Story = { args: { connection: ConnectionStatus.Offline } }
export const PairingOffline: Story = { args: { ...PairMac.args, connection: ConnectionStatus.Offline } }
export const Session: Story = { args: { page: StoryPage.Session } }
export const CodexSession: Story = { args: { page: StoryPage.Session, sessionProps: { session: codexDesktopSession } } }
export const SessionHistoryLoading: Story = {
  args: { page: StoryPage.Session, sessionProps: { messages: [], historyStatus: HistoryStatus.Loading } },
}
export const SessionOffline: Story = { args: { page: StoryPage.Session, connection: ConnectionStatus.Offline } }
export const UnknownDelivery: Story = { args: { page: StoryPage.Session, error: ErrorCode.COMMAND_STATUS_UNKNOWN } }
export const CheckingDelivery: Story = { args: { ...UnknownDelivery.args, busy: true } }
export const DeliveryReceipt: Story = { args: { page: StoryPage.Session, result: CommandStatus.Dispatched } }
export const PermissionRequired: Story = {
  args: {
    page: StoryPage.Session,
    sessionProps: {
      session: { ...terminalSession, status: SessionStatus.WaitingPermission },
      state: sessionState({ snapshot: { ...snapshot, permissions: [{ ...permission, expiresAt: 4102444800000 }] } }),
    },
  },
}
export const English: Story = { args: { page: StoryPage.Session }, globals: { language: Language.En } }
export const Dark: Story = { args: { page: StoryPage.Session }, globals: { theme: ThemePreference.Dark } }
export const MobileSession: Story = {
  args: { page: StoryPage.Session },
  globals: { viewport: { value: "mobile", isRotated: false } },
  parameters: { viewport: { options: { mobile: { name: "Mobile", styles: { width: "390px", height: "844px" } } } } },
}
export const MobileEnglishDark: Story = {
  ...MobileSession,
  args: { page: StoryPage.Session, sessionProps: { session: codexDesktopSession } },
  globals: { ...MobileSession.globals, language: Language.En, theme: ThemePreference.Dark },
}
export const MobileSignIn: Story = { ...MobileSession, args: { page: StoryPage.SignIn, connection: ConnectionStatus.Expired } }
export const MobileSessions: Story = { ...MobileSession, args: { page: StoryPage.Sessions } }
export const MobilePermissionRequired: Story = { ...MobileSession, args: { ...PermissionRequired.args } }
export const ShortViewportDraft: Story = {
  ...MobileSession,
  parameters: { viewport: { options: { mobile: { name: "Short viewport", styles: { width: "390px", height: "540px" } } } } },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByTestId(COMMAND_IDS.prompt), "Synthetic draft{enter}Second line{enter}Third line")
  },
}
