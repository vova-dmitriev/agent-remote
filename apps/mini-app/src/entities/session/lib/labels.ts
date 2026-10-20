import { IntegrationState, SessionStatus, TargetKind, type Session, type ConnectorDescriptor } from "@protocol"
import type { MessageKey } from "@/shared/lib/i18n"
import { AgentName } from "../config/session-values"

export const sourceNames: Record<Session["target"]["kind"], MessageKey> = {
  [TargetKind.ClaudeCodeCli]: "sourceCli",
  [TargetKind.ClaudeCodeDesktop]: "sourceCode",
  [TargetKind.ClaudeDesktopChat]: "sourceChat",
  [TargetKind.CodexCli]: "sourceCodexCli",
  [TargetKind.CodexDesktop]: "sourceCodexDesktop",
  [TargetKind.Cmux]: "sourceCmux",
}

function sourceSessionId(session: Session): string | null {
  return "threadId" in session.target ? session.target.threadId : session.claudeSessionId
}

export function sessionTitle(session: Session, fallbackLength: number): string | null {
  return session.title?.trim() || sourceSessionId(session)?.slice(0, fallbackLength) || null
}

export function agentName(session: Session): AgentName {
  return session.target.kind === TargetKind.CodexCli || session.target.kind === TargetKind.CodexDesktop ? AgentName.Codex : AgentName.Claude
}

export const statuses: Record<Session["status"], MessageKey> = {
  [SessionStatus.Unknown]: "statusUnknown",
  [SessionStatus.Idle]: "statusIdle",
  [SessionStatus.Running]: "statusRunning",
  [SessionStatus.WaitingPermission]: "statusPermission",
  [SessionStatus.WaitingInput]: "statusInput",
  [SessionStatus.Ended]: "statusEnded",
}
export const connectorStates: Record<ConnectorDescriptor["state"], MessageKey> = {
  [IntegrationState.Ready]: "connectorReady",
  [IntegrationState.NeedsSetup]: "connectorSetup",
  [IntegrationState.NeedsRestart]: "connectorSetup",
  [IntegrationState.Unsupported]: "connectorUnavailable",
  [IntegrationState.Disconnected]: "connectorDisconnected",
}

/** The folder the session works in: the last segment of its working directory. */
export function sessionFolder(session: Session): string | null {
  return session.cwd?.split("/").filter(Boolean).pop() ?? null
}

/** The working directory with the macOS home folder shortened to `~`. */
export function sessionPath(session: Session): string | null {
  return session.cwd?.replace(/^\/Users\/[^/]+(?=\/|$)/, "~") ?? null
}
