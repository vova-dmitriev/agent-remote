import type { StoreApi } from "zustand/vanilla"
import { CapabilityKey, CommandActionType, PromptDelivery, DeviceStatus, ConnectionStatus, ErrorCode } from "@protocol"
import {
  PromptStatus,
  canSendQueuedNow,
  canSend,
  PROMPT_RECEIPT_POLL_MS,
  readyPrompts,
  samePromptSource,
  type QueuedPrompt,
  type SessionStoreState,
} from "@/entities/session"
import { PromptDeliveryMode } from "@/features/send-command/config/values"
import { reconcilePromptBarriers } from "./barriers"
import type { PromptBarrier } from "./types"

export class PromptDispatcher {
  private stopped = true
  private inFlight = new Set<string>()
  private barriers = new Map<string, PromptBarrier>()

  constructor(private store: StoreApi<SessionStoreState>) {}

  start() {
    this.stopped = false
    const unsubscribe = this.store.subscribe(() => this.drain())

    const timer = setInterval(() => {
      this.drain()
      for (const item of this.store.getState().outbox)
        if (item.status === PromptStatus.Accepted) void this.deliver(item, PromptDeliveryMode.Check)
    }, PROMPT_RECEIPT_POLL_MS)

    this.drain()

    return () => {
      this.stopped = true
      unsubscribe()
      clearInterval(timer)
    }
  }

  private drain() {
    if (this.stopped) return
    const state = this.store.getState()
    const epoch = state.runtime.epoch

    reconcilePromptBarriers(state, this.barriers)

    for (const item of state.outbox) {
      if (item.runtimeEpoch !== epoch && item.status !== PromptStatus.Stale) state.updatePrompt(item.command.commandId, PromptStatus.Stale)
    }

    for (const item of readyPrompts(this.store.getState(), epoch)) {
      if (!this.barriers.has(item.command.sessionId)) void this.deliver(item, PromptDeliveryMode.Send)
    }
  }

  canSendNow(id: string) {
    return !this.stopped && !this.inFlight.has(id) && canSendQueuedNow(this.store.getState(), id)
  }

  async sendNow(id: string) {
    const item = this.store.getState().outbox.find((entry) => entry.command.commandId === id)

    if (item && this.canSendNow(id)) await this.deliver(item, PromptDeliveryMode.Immediate)
  }

  async deliver(item: QueuedPrompt, mode: PromptDeliveryMode) {
    const state = this.store.getState()
    const lease = state.runtime.current()
    const id = item.command.commandId
    const owned = state.outbox.find((entry) => entry.command.commandId === id)
    const session = state.session.snapshot?.sessions.find((session) => session.id === item.command.sessionId)

    if (this.stopped || !owned || !lease || this.inFlight.has(id)) return
    item = owned
    const sending = mode === PromptDeliveryMode.Send || mode === PromptDeliveryMode.Immediate

    if (sending && item.status !== PromptStatus.Queued) return
    if (mode === PromptDeliveryMode.Immediate && !this.canSendNow(id)) return

    if (!samePromptSource(item, state, lease.epoch)) {
      state.updatePrompt(id, PromptStatus.Stale)

      return
    }

    if (
      mode === PromptDeliveryMode.Send &&
      (!session ||
        !canSend(state.session.connection, state.session.snapshot?.deviceStatus ?? DeviceStatus.Offline, session, CapabilityKey.Prompt))
    )
      return
    if (state.session.connection !== ConnectionStatus.Online) return
    this.inFlight.add(id)

    if (mode !== PromptDeliveryMode.Check) {
      this.barriers.set(item.command.sessionId, {
        commandId: id,
        generation: session!.generation,
        runtimeEpoch: lease.epoch,
        deviceId: item.command.target.deviceId,
        streamId: item.streamId,
        lastEventAt: session!.lastEventAt,
        observedBusy: false,
      })

      if (mode === PromptDeliveryMode.Immediate && item.command.action.type === CommandActionType.Prompt) {
        item = { ...item, command: { ...item.command, action: { ...item.command.action, delivery: PromptDelivery.Immediate } } }
      }

      const sendingItem = { ...item, status: PromptStatus.Sending }

      this.store.setState((current) => ({ outbox: current.outbox.map((entry) => (entry.command.commandId === id ? sendingItem : entry)) }))
    }

    try {
      const response = await (sending
        ? lease.client.send(item.command)
        : mode === PromptDeliveryMode.Retry
          ? lease.client.retryPending(id)
          : lease.client.checkPending(id))

      if (!state.runtime.isCurrent(lease) || this.stopped) return
      this.store.getState().finishPrompt(response)
    } catch (error) {
      if (!state.runtime.isCurrent(lease) || this.stopped) return
      if (mode === PromptDeliveryMode.Check) return
      const code = error instanceof Error ? error.message : ErrorCode.COMMAND_DELIVERY_FAILED

      const uncertain =
        !sending || [ErrorCode.COMMAND_STATUS_UNKNOWN, ErrorCode.COMMAND_PENDING_STATUS].some((candidate) => candidate === code)

      if (this.store.getState().outbox.find((entry) => entry.command.commandId === id)?.status !== PromptStatus.Stale)
        this.store.getState().updatePrompt(id, uncertain ? PromptStatus.Unknown : PromptStatus.Failed, code)
      if (!uncertain) this.barriers.delete(item.command.sessionId)
    } finally {
      this.inFlight.delete(id)
      this.drain()
    }
  }
}
