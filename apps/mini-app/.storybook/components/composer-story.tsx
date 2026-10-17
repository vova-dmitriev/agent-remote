import { ConnectionStatus, DeviceStatus, type Session } from "@protocol"
import { SessionComposer } from "@/features/send-command"
import { useCommandFixture } from "../model/use-command-fixture"

export function ComposerStory({ session }: { session: Session }) {
  const controller = useCommandFixture()

  return (
    <SessionComposer controller={controller} session={session} connection={ConnectionStatus.Online} deviceStatus={DeviceStatus.Online} />
  )
}
