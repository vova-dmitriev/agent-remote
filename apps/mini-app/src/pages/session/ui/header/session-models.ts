import { AgentProvider, ConnectionStatus, DeviceStatus, SessionStatus, TargetKind, type Session } from "@protocol"
import type { SessionState } from "@/entities/session"

/** Where each kind of session takes a model switch: Codex threads with their turns, Claude Code in its terminal. */
const MODEL_PROVIDER: Partial<Record<TargetKind, AgentProvider>> = {
  [TargetKind.CodexCli]: AgentProvider.Codex,
  [TargetKind.CodexDesktop]: AgentProvider.Codex,
  [TargetKind.ClaudeCodeCli]: AgentProvider.Claude,
  [TargetKind.Cmux]: AgentProvider.Claude,
}

/** The models a session that takes prompts can switch to, when the device lists them for its agent; null otherwise. */
export function sessionModels(session: Session, state: SessionState) {
  const provider = MODEL_PROVIDER[session.target.kind]
  const models = state.snapshot?.models?.find((entry) => entry.provider === provider)?.models ?? []

  if (!session.capabilities.prompt || session.status === SessionStatus.Ended || !models.length) return null

  return {
    models,
    disabled: state.connection !== ConnectionStatus.Online || state.snapshot?.deviceStatus !== DeviceStatus.Online,
  }
}
