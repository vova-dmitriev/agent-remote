import type { ComponentProps } from "react"
import { CommandActionType, ConnectionStatus, DeviceStatus } from "@protocol"
import type { SessionCreation } from "@/features/create-session"
import type { useApplication } from "./use-application"

type CreationProps = ComponentProps<typeof SessionCreation>

/** Props for the create-session feature, shared by the session list and the desktop "New session" pane. */
export function sessionCreationProps(model: ReturnType<typeof useApplication>): CreationProps {
  const { state, commands } = model
  const online = state.connection === ConnectionStatus.Online && state.snapshot?.deviceStatus === DeviceStatus.Online

  return {
    sessions: state.snapshot?.sessions ?? [],
    online,
    disabled: !online || commands.busy || commands.awaitingReceipt || commands.uncertain,
    create: (session, provider, execution) =>
      void commands.action(
        { type: CommandActionType.CreateSession, provider, cwd: session.cwd!, ...(execution ? { execution } : {}) },
        session,
      ),
  }
}
