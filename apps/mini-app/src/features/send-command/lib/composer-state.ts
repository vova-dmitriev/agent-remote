import { DeviceStatus, TargetKind, type Session } from "@protocol"
import { canQueuePrompt } from "@/entities/session"
import type { Connection } from "@/shared/api"
import type { CommandController } from "../model/use-command"

export function composerState(controller: CommandController, session: Session, connection: Connection, device: DeviceStatus) {
  const promptDisabled = !canQueuePrompt(connection, device, session)

  const attachments = controller.attachments
  const hasAttachments = !!attachments.items.length

  return {
    promptDisabled,
    attachmentDisabled: promptDisabled,
    acceptsAttachments: !!session.capabilities.attachments && !promptDisabled,
    sendDisabled: promptDisabled || !attachments.ready || (!controller.prompt.trim() && !hasAttachments),
    showNativeHint: !session.capabilities.prompt && session.target.kind === TargetKind.ClaudeCodeCli,
  }
}
