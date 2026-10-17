import { CapabilityKey, DeviceStatus, CommandStatus, PromptDelivery, canDeliverPrompt, type CommandResult } from "@protocol"
import { canQueuePrompt, canSend } from "@/entities/session/model/session-state"
import { PromptStatus } from "./constants"
import type { SessionStoreState } from "../types"
import type { QueuedPrompt } from "./types"

export function samePromptSource(item: QueuedPrompt, state: SessionStoreState, epoch: number) {
  const session = state.session.snapshot?.sessions.find((session) => session.id === item.command.sessionId)

  return (
    !!session &&
    item.runtimeEpoch === epoch &&
    item.streamId === state.session.snapshot?.cursor.streamId &&
    session.generation === item.command.generation &&
    state.session.deviceId === item.command.target.deviceId &&
    JSON.stringify(session.target) === JSON.stringify(item.command.target)
  )
}

export function readyPrompts(state: SessionStoreState, epoch: number) {
  const seen = new Set<string>()

  return state.outbox.filter((item) => {
    const id = item.command.sessionId

    if (seen.has(id)) return false
    seen.add(id)
    const session = state.session.snapshot?.sessions.find((session) => session.id === id)

    return (
      item.status === PromptStatus.Queued &&
      samePromptSource(item, state, epoch) &&
      !!session &&
      canSend(state.session.connection, state.session.snapshot?.deviceStatus ?? DeviceStatus.Offline, session, CapabilityKey.Prompt)
    )
  })
}

export function observePrompt(items: QueuedPrompt[], receipt: CommandResult) {
  return items.flatMap((item): QueuedPrompt[] => {
    if (item.command.commandId !== receipt.commandId || item.status === PromptStatus.Stale) return [item]
    if (receipt.status === CommandStatus.Dispatched) return []
    if (receipt.status === CommandStatus.Accepted && item.status === PromptStatus.Unknown) return [item]

    return [{ ...item, status: receipt.status === CommandStatus.Rejected ? PromptStatus.Failed : receipt.status, code: receipt.code }]
  })
}

export function canSendQueuedNow(state: SessionStoreState, id: string) {
  const item = state.outbox.find((entry) => entry.command.commandId === id)
  const lease = state.runtime.current()
  const session = state.session.snapshot?.sessions.find((entry) => entry.id === item?.command.sessionId)

  return (
    !!item &&
    item.status === PromptStatus.Queued &&
    !!lease &&
    !!session &&
    samePromptSource(item, state, lease.epoch) &&
    canQueuePrompt(state.session.connection, state.session.snapshot?.deviceStatus ?? DeviceStatus.Offline, session) &&
    canDeliverPrompt(session.status, PromptDelivery.Immediate) &&
    !state.outbox.some(
      (entry) =>
        entry.command.sessionId === session.id &&
        [PromptStatus.Sending, PromptStatus.Accepted, PromptStatus.Unknown].some((status) => entry.status === status),
    )
  )
}
