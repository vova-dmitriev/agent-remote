import { ControlStatus } from "@/features/send-command/config/values"
import type { ClientCommand } from "@protocol"

export interface PendingControl {
  command: ClientCommand
  key: string
  runtimeEpoch: number
  status: ControlStatus
}
