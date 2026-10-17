import {
  SessionStatus,
  TargetKind,
  ConnectorTransport,
  BindingState,
  IntegrationState,
  StatusConfidence,
  MessageRole,
  DeviceStatus,
  type Session,
  type AppSnapshot,
  type HistoryMessage,
  type PendingPermission,
} from "@protocol"

export const terminalSession: Session = {
  id: "terminal-session",
  target: {
    kind: TargetKind.ClaudeCodeCli,
    deviceId: "fixture-mac",
    connectorId: ConnectorTransport.Pty,
    claudeSessionId: "fixture-context",
  },
  claudeSessionId: "fixture-context",
  generation: "fixture-generation",
  model: "claude-sonnet-4-6",
  status: SessionStatus.Idle,
  binding: BindingState.Verified,
  lastEventAt: 1700000000000,
  capabilities: { observe: true, history: true, prompt: true, interrupt: true, permission: true, terminalSnapshot: true },
  integrationState: IntegrationState.Ready,
  statusConfidence: StatusConfidence.Observed,
}
export const chatSession: Session = {
  ...terminalSession,
  id: "chat-session",
  model: undefined,
  target: { kind: TargetKind.ClaudeDesktopChat, deviceId: "fixture-mac", connectorId: "chat", chatBindingId: "fixture-binding" },
  claudeSessionId: null,
  capabilities: { ...terminalSession.capabilities, permission: false, terminalSnapshot: false },
  statusConfidence: StatusConfidence.Inferred,
}
export const codexCliSession: Session = {
  ...terminalSession,
  id: "codex-cli-session",
  model: "gpt-synthetic-cli",
  target: { kind: TargetKind.CodexCli, deviceId: "fixture-mac", connectorId: TargetKind.CodexCli, threadId: "fixture-codex-cli-thread" },
  claudeSessionId: null,
  capabilities: { ...terminalSession.capabilities, terminalSnapshot: false },
}
export const codexDesktopSession: Session = {
  ...codexCliSession,
  id: "codex-desktop-session",
  model: "gpt-synthetic-desktop",
  target: {
    kind: TargetKind.CodexDesktop,
    deviceId: "fixture-mac",
    connectorId: TargetKind.CodexDesktop,
    threadId: "fixture-codex-desktop-thread",
  },
}
export const permission: PendingPermission = {
  requestId: "fixture-permission",
  sessionId: terminalSession.id,
  generation: terminalSession.generation,
  toolName: "Bash",
  input: { command: "pwd" },
  expiresAt: Date.now() + 120000,
}
export const messages: HistoryMessage[] = [
  { id: "one", role: MessageRole.User, text: "Continue the synthetic example.", occurredAt: 1700000000000 },
  { id: "two", role: MessageRole.Assistant, text: "The local session is ready.", occurredAt: 1700000001000 },
]
export const snapshot: AppSnapshot = {
  sessions: [terminalSession, chatSession],
  deviceStatus: DeviceStatus.Online,
  cursor: { streamId: "fixture", seq: 0 },
  permissions: [permission],
  terminal: {
    sessionId: terminalSession.id,
    generation: terminalSession.generation,
    text: "<script>literal terminal text</script>",
    capturedAt: 1700000000000,
  },
}
