import { SessionStatus } from "@protocol"
import { PromptStatus, type SessionStoreState } from "@/entities/session"
import type { PromptBarrier } from "./types"

export function reconcilePromptBarriers(state: SessionStoreState, barriers: Map<string, PromptBarrier>) {
  for (const session of state.session.snapshot?.sessions ?? []) {
    const barrier = barriers.get(session.id)

    if (!barrier) continue

    if (
      barrier.generation !== session.generation ||
      barrier.runtimeEpoch !== state.runtime.epoch ||
      barrier.deviceId !== state.session.deviceId ||
      barrier.streamId !== state.session.snapshot?.cursor.streamId ||
      state.outbox.some((item) => item.command.commandId === barrier.commandId && item.status === PromptStatus.Failed)
    ) {
      barriers.delete(session.id)

      continue
    }

    if (session.status !== SessionStatus.Idle) barrier.observedBusy = true
    else if (barrier.observedBusy || barrier.lastEventAt !== session.lastEventAt) barriers.delete(session.id)
  }
}
