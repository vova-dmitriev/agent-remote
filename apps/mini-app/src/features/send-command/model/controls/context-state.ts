import { CommandActionType } from "@protocol"
import { ControlStatus } from "@/features/send-command/config/values"
import type { PendingControl } from "./types"

export function controlState(entries: Iterable<PendingControl>, sessionId: string | undefined, epoch: number, generation?: string) {
  const relevant = [...entries].filter(
    (entry) =>
      entry.runtimeEpoch === epoch &&
      (!generation || entry.command.generation === generation) &&
      (sessionId ? entry.command.sessionId === sessionId : entry.command.action.type === CommandActionType.CreateSession),
  )

  return {
    awaitingReceipt: relevant.some((entry) => entry.status === ControlStatus.Sending || entry.status === ControlStatus.Accepted),
    uncertain: relevant.some((entry) => entry.status === ControlStatus.Unknown),
    pendingUserInputs: relevant.flatMap((entry) =>
      entry.command.action.type === CommandActionType.UserInput ? [entry.command.action.requestId] : [],
    ),
  }
}
