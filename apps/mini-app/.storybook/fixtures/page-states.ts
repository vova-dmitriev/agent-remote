import {
  ErrorCode,
  TargetKind,
  SessionStatus,
  ConnectorTransport,
  IntegrationState,
  ConnectionStatus,
  type ConnectorDescriptor,
  type Session,
} from "@protocol"
import { initialState, type SessionState } from "@/entities/session"
import { terminalSession, chatSession, codexCliSession, codexDesktopSession, snapshot } from "./session"

export const desktopCodeSession: Session = {
  ...terminalSession,
  id: "desktop-code-session",
  target: { ...terminalSession.target, kind: TargetKind.ClaudeCodeDesktop, claudeSessionId: "fixture-desktop-code" },
}

export const cmuxSession: Session = {
  ...terminalSession,
  id: "cmux-session",
  target: {
    kind: TargetKind.Cmux,
    deviceId: "fixture-mac",
    connectorId: "cmux",
    windowId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
    surfaceId: "10000000-0000-4000-8000-000000000003",
  },
}

export const allSources = [terminalSession, desktopCodeSession, chatSession, cmuxSession, codexCliSession, codexDesktopSession]

export const readOnlySession: Session = {
  ...chatSession,
  capabilities: { ...chatSession.capabilities, prompt: false, interrupt: false },
}

const statuses: Session["status"][] = [
  SessionStatus.Idle,
  SessionStatus.Running,
  SessionStatus.WaitingPermission,
  SessionStatus.WaitingInput,
  SessionStatus.Ended,
  SessionStatus.Unknown,
]

export const sessionStatuses: Session[] = statuses.map((status, index) => ({ ...terminalSession, id: `status-${index}`, status }))

const sources = [
  { connectorId: "pty", kind: TargetKind.ClaudeCodeCli, state: IntegrationState.Ready, transport: ConnectorTransport.Pty, reason: null },
  {
    connectorId: "chat",
    kind: TargetKind.ClaudeDesktopChat,
    state: IntegrationState.NeedsSetup,
    transport: ConnectorTransport.Accessibility,
    reason: ErrorCode.AX_CHAT_OR_COMPOSER_UNVERIFIED,
  },
  {
    connectorId: "code",
    kind: TargetKind.ClaudeCodeDesktop,
    state: IntegrationState.NeedsRestart,
    transport: ConnectorTransport.Hooks,
    reason: ErrorCode.DESKTOP_CODE_ID_UNVERIFIED,
  },
  {
    connectorId: "codex",
    kind: TargetKind.CodexCli,
    state: IntegrationState.Disconnected,
    transport: ConnectorTransport.AppServer,
    reason: ErrorCode.CODEX_DISCONNECTED,
  },
  { connectorId: "cmux", kind: TargetKind.Cmux, state: IntegrationState.Unsupported, transport: ConnectorTransport.Cmux, reason: null },
] satisfies Pick<ConnectorDescriptor, "connectorId" | "kind" | "state" | "transport" | "reason">[]

export const connectors: ConnectorDescriptor[] = sources.map((connector) => ({
  ...connector,
  sourceVersion: "synthetic",
  capabilities: terminalSession.capabilities,
}))

export const desktopConnections: ConnectorDescriptor[] = ["first", "second"].map((id) => ({
  connectorId: "synthetic-desktop-" + id,
  kind: TargetKind.CodexDesktop,
  state: IntegrationState.Ready,
  transport: ConnectorTransport.AppServer,
  reason: null,
  sourceVersion: "synthetic",
  capabilities: codexDesktopSession.capabilities,
}))

export const mixedDesktopConnections: ConnectorDescriptor[] = [
  ...desktopConnections,
  {
    ...desktopConnections[0]!,
    connectorId: "synthetic-offline-desktop",
    state: IntegrationState.Disconnected,
    reason: ErrorCode.CODEX_DISCONNECTED,
  },
]

export function sessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    ...initialState(),
    connection: ConnectionStatus.Online,
    deviceId: "fixture-mac",
    selectedId: terminalSession.id,
    snapshot: { ...snapshot, permissions: [] },
    ...overrides,
  }
}
