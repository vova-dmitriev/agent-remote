import { AgentProvider, ConnectionStatus, DeviceStatus, SessionStatus, TargetKind } from "@protocol"
import { ModelChips } from "@/features/switch-model"
import type { SessionModelChipsProps } from "../session-page.types"

/** Where each kind of session takes a model switch: Codex threads with their turns, Claude Code in its terminal. */
const MODEL_PROVIDER: Partial<Record<TargetKind, AgentProvider>> = {
  [TargetKind.CodexCli]: AgentProvider.Codex,
  [TargetKind.CodexDesktop]: AgentProvider.Codex,
  [TargetKind.ClaudeCodeCli]: AgentProvider.Claude,
  [TargetKind.Cmux]: AgentProvider.Claude,
}

/** The model chips of a session that takes prompts, when the device lists models for its agent. */
export function SessionModelChips({ session, state, controller }: SessionModelChipsProps) {
  const provider = MODEL_PROVIDER[session.target.kind]
  const models = state.snapshot?.models?.find((entry) => entry.provider === provider)?.models ?? []

  if (!controller || !session.capabilities.prompt || session.status === SessionStatus.Ended || !models.length) return null

  return (
    <ModelChips
      session={session}
      models={models}
      controller={controller}
      disabled={state.connection !== ConnectionStatus.Online || state.snapshot?.deviceStatus !== DeviceStatus.Online}
    />
  )
}
