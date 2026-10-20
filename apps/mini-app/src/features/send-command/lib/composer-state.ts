import { ConnectionStatus, DeviceStatus, TargetKind, type Session } from "@protocol"
import { canQueuePrompt, sourceAvailable } from "@/entities/session"
import type { MessageKey } from "@/shared/lib/i18n"
import type { Connection } from "@/shared/api"
import type { CommandController } from "../model/use-command"

export function composerState(
  controller: CommandController,
  prompt: string,
  session: Session,
  connection: Connection,
  device: DeviceStatus,
) {
  const promptDisabled = !canQueuePrompt(connection, device, session) || controller.attachments.restoring === true

  const attachments = controller.attachments
  const hasAttachments = !!attachments.items.length

  return {
    promptDisabled,
    attachmentDisabled: promptDisabled,
    acceptsAttachments: !!session.capabilities.attachments && !promptDisabled,
    sendDisabled: promptDisabled || !attachments.ready || (!prompt.trim() && !hasAttachments),
    showNativeHint: !session.capabilities.prompt && session.target.kind === TargetKind.ClaudeCodeCli,
    unavailableHint: unavailableHint(session, connection, device),
  }
}

function unavailableHint(session: Session, connection: Connection, device: DeviceStatus): MessageKey | undefined {
  if (connection !== ConnectionStatus.Online) return "networkUnavailable"
  if (device !== DeviceStatus.Online) return "deviceOffline"
  if (!sourceAvailable(session)) return "sourceUnavailable"
  if (!session.capabilities.prompt) return "observeOnly"

  return undefined
}
