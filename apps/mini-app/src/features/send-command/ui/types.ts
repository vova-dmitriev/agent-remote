import { DeviceStatus, type Session } from "@protocol"
import type { Connection } from "@/shared/api"
import type { CommandController } from "../model/use-command"

export interface CommandNoticeProps {
  error: string
  busy: boolean
  retry: () => void
}

export interface SessionComposerProps {
  controller: CommandController
  session: Session
  connection: Connection
  deviceStatus: DeviceStatus
}
