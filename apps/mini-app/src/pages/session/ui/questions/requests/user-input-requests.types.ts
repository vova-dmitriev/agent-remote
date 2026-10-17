import type { Session } from "@protocol"
import type { SessionState } from "@/entities/session"
import type { CommandController } from "@/features/send-command"

export interface UserInputRequestsProps {
  session: Session
  state: SessionState
  controller: CommandController
}
