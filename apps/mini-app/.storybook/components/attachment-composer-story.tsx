import { AttachmentMode, ConnectionStatus, DeviceStatus } from "@protocol"
import { SessionComposer, useCommand } from "@/features/send-command"
import { useSyntheticRuntime } from "../model/use-synthetic-runtime"
import { terminalSession } from "../fixtures/session"

const session = {
  ...terminalSession,
  capabilities: { ...terminalSession.capabilities, attachments: { images: AttachmentMode.Native, files: AttachmentMode.Reference } },
}

export function AttachmentComposerStory() {
  useSyntheticRuntime(session)
  const controller = useCommand()

  return (
    <SessionComposer controller={controller} session={session} connection={ConnectionStatus.Online} deviceStatus={DeviceStatus.Online} />
  )
}
