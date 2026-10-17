import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  HistoryStatus,
  SessionStatus,
  ConnectionStatus,
  DeviceStatus,
  BindingState,
  IntegrationState,
  ThemePreference,
  Language,
  ErrorCode,
} from "@protocol"
import { SessionTab } from "@/entities/session"
import { SessionPageStory } from "@storybook-components/session-page-story"
import { terminalSession, chatSession, codexCliSession, codexDesktopSession, snapshot, permission } from "@storybook-fixtures/session"
import { desktopCodeSession, cmuxSession, readOnlySession, sessionState } from "@storybook-fixtures/page-states"
import { questionRequest } from "./questions/fixtures"

const meta = { component: SessionPageStory } satisfies Meta<typeof SessionPageStory>

export default meta
export const Connected: StoryObj<typeof meta> = {}
export const ClaudeDesktopCode: StoryObj<typeof meta> = { args: { session: desktopCodeSession } }
export const ClaudeDesktopChat: StoryObj<typeof meta> = { args: { session: chatSession } }
export const Cmux: StoryObj<typeof meta> = { args: { session: cmuxSession } }
export const CodexCli: StoryObj<typeof meta> = { args: { session: codexCliSession } }
export const CodexDesktop: StoryObj<typeof meta> = { args: { session: codexDesktopSession } }
export const LoadingHistory: StoryObj<typeof meta> = { args: { messages: [], historyStatus: HistoryStatus.Loading } }
export const EmptyHistory: StoryObj<typeof meta> = { args: { messages: [] } }
export const Running: StoryObj<typeof meta> = { args: { session: { ...terminalSession, status: SessionStatus.Running } } }
export const WaitingForInput: StoryObj<typeof meta> = { args: { session: { ...terminalSession, status: SessionStatus.WaitingInput } } }
export const Ended: StoryObj<typeof meta> = { args: { session: { ...terminalSession, status: SessionStatus.Ended } } }
export const UnknownStatus: StoryObj<typeof meta> = { args: { session: { ...terminalSession, status: SessionStatus.Unknown } } }
export const ReadOnly: StoryObj<typeof meta> = { args: { session: readOnlySession } }
export const Busy: StoryObj<typeof meta> = { args: { busy: true } }
export const Offline: StoryObj<typeof meta> = { args: { state: sessionState({ connection: ConnectionStatus.Offline }) } }
export const Reconnecting: StoryObj<typeof meta> = { args: { state: sessionState({ connection: ConnectionStatus.Connecting }) } }
export const DeviceOffline: StoryObj<typeof meta> = {
  args: { state: sessionState({ snapshot: { ...snapshot, deviceStatus: DeviceStatus.Offline, permissions: [], terminal: null } }) },
}
export const PermissionRequired: StoryObj<typeof meta> = {
  args: {
    session: { ...terminalSession, status: SessionStatus.WaitingPermission },
    state: sessionState({ snapshot: { ...snapshot, permissions: [{ ...permission, expiresAt: 4102444800000 }] } }),
  },
}
export const PermissionBusy: StoryObj<typeof meta> = { args: { ...PermissionRequired.args, busy: true } }
export const PermissionOffline: StoryObj<typeof meta> = {
  args: {
    ...PermissionRequired.args,
    state: sessionState({
      connection: ConnectionStatus.Offline,
      snapshot: { ...snapshot, permissions: [{ ...permission, expiresAt: 4102444800000 }] },
    }),
  },
}
export const PermissionExpired: StoryObj<typeof meta> = {
  args: {
    ...PermissionRequired.args,
    state: sessionState({ snapshot: { ...snapshot, permissions: [{ ...permission, expiresAt: 1 }] } }),
  },
}
export const Terminal: StoryObj<typeof meta> = { args: { tab: SessionTab.Terminal } }
export const TerminalWaiting: StoryObj<typeof meta> = {
  args: { tab: SessionTab.Terminal, state: sessionState({ snapshot: { ...snapshot, permissions: [], terminal: null } }) },
}
export const NativeObservation: StoryObj<typeof meta> = {
  args: {
    session: {
      ...terminalSession,
      binding: BindingState.Unverified,
      integrationState: IntegrationState.NeedsRestart,
      capabilities: { ...terminalSession.capabilities, prompt: false, interrupt: false },
    },
  },
}
export const CodexModelUnavailable: StoryObj<typeof meta> = {
  args: { session: { ...codexCliSession, errorCode: ErrorCode.CODEX_MODEL_UNAVAILABLE } },
}
export const CodexAuthRequired: StoryObj<typeof meta> = {
  args: { session: { ...codexDesktopSession, errorCode: ErrorCode.CODEX_AUTH_REQUIRED } },
}
export const CodexNetworkError: StoryObj<typeof meta> = {
  args: { session: { ...codexCliSession, errorCode: ErrorCode.CODEX_NETWORK_ERROR } },
}
export const CodexTurnFailed: StoryObj<typeof meta> = {
  args: { session: { ...codexDesktopSession, errorCode: ErrorCode.CODEX_TURN_FAILED } },
}

export const Dark: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Dark } }

export const English: StoryObj<typeof meta> = { globals: { language: Language.En } }
export const PendingQuestion: StoryObj<typeof meta> = {
  args: {
    session: { ...codexDesktopSession, capabilities: { ...codexDesktopSession.capabilities, userInput: true } },
    state: sessionState({
      snapshot: {
        ...snapshot,
        userInputs: [{ ...questionRequest, sessionId: codexDesktopSession.id, generation: codexDesktopSession.generation }],
      },
    }),
  },
}
export const PendingQuestionDark: StoryObj<typeof meta> = { ...PendingQuestion, globals: { theme: ThemePreference.Dark } }
