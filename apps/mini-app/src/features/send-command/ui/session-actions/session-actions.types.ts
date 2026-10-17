import { DeviceStatus, type Session } from "@protocol"
import type { Connection } from "@/shared/api"
import type { CommandController } from "@/features/send-command/model/use-command"

export interface SessionActionsProps {
  session: Session
  controller: CommandController
  connection: Connection
  deviceStatus: DeviceStatus
}
