import type { ComponentProps } from "react"
import { CommandActionType, ConnectionStatus, DeviceStatus, ErrorCode } from "@protocol"
import type { SessionCreation } from "@/features/create-session"
import type { useApplication } from "./use-application"

type CreationProps = ComponentProps<typeof SessionCreation>

/** Props for the create-session feature, shared by the session list and the desktop "New session" pane. */
export function sessionCreationProps(model: ReturnType<typeof useApplication>): CreationProps {
  const { state, commands, runtime } = model
  const online = state.connection === ConnectionStatus.Online && state.snapshot?.deviceStatus === DeviceStatus.Online

  return {
    sessions: state.snapshot?.sessions ?? [],
    online,
    disabled: !online || commands.busy || commands.awaitingReceipt || commands.uncertain,
    models: state.snapshot?.models ?? [],
    projects: state.snapshot?.projects ?? [],
    createInProject: async (cwd, provider, model, resume) => {
      const lease = runtime.current()

      if (!lease || !state.deviceId) throw new Error(ErrorCode.NO_AUTHENTICATED_CLIENT)

      const { sessionId } = await lease.client.createProjectSession(state.deviceId, {
        provider,
        cwd,
        ...(model ? { model } : {}),
        ...(resume ? { resume } : {}),
      })

      commands.openCreatedSession(sessionId)
    },
    create: (session, provider, execution, model, resume) =>
      void commands.action(
        {
          type: CommandActionType.CreateSession,
          provider,
          cwd: session.cwd!,
          ...(execution ? { execution } : {}),
          ...(model ? { model } : {}),
          ...(resume ? { resume } : {}),
        },
        session,
      ),
  }
}
