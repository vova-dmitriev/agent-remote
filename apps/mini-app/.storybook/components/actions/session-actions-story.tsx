import type { ComponentProps } from "react"
import { ConnectionStatus, DeviceStatus } from "@protocol"
import { SessionActions } from "@/features/send-command"
import { useCommandFixture } from "../../model/use-command-fixture"
import { terminalSession } from "../../fixtures/session"

type Props = ComponentProps<typeof SessionActions>

export function SessionActionsStory({
  session = terminalSession,
  connection = ConnectionStatus.Online,
  deviceStatus = DeviceStatus.Online,
  busy = false,
}: Partial<Pick<Props, "session" | "connection" | "deviceStatus">> & { busy?: boolean }) {
  const controller = useCommandFixture()

  return <SessionActions session={session} connection={connection} deviceStatus={deviceStatus} controller={{ ...controller, busy }} />
}
