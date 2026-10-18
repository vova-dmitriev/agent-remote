import type { StoreApi } from "zustand/vanilla"
import { CommandStatus, ErrorCode, type ClientCommand } from "@protocol"
import { readQueueReceipts } from "./receipts"
import { PromptStatus, type SessionStoreState, type QueuedPrompt } from "@/entities/session"

export class QueueState {
  protected queues = new Map<string, { revision: number; intents: ClientCommand[] }>()
  protected stopped = false
  protected busy = new Set<string>()
  private leaseEpoch = 0

  constructor(protected store: StoreApi<SessionStoreState>) {}

  protected context(sessionId: string) {
    const state = this.store.getState()
    const lease = state.runtime.current()
    const session = state.session.snapshot?.sessions.find((item) => item.id === sessionId)
    const streamId = state.session.snapshot?.cursor.streamId

    if (!lease?.client.persistence || !session || !streamId || this.stopped) throw new Error(ErrorCode.STALE_SESSION)

    if (this.leaseEpoch !== lease.epoch) {
      this.queues.clear()
      this.leaseEpoch = lease.epoch
    }

    const current = () =>
      !this.stopped &&
      state.runtime.isCurrent(lease) &&
      this.store.getState().session.snapshot?.cursor.streamId === streamId &&
      this.store.getState().session.snapshot?.sessions.some((item) => item.id === sessionId && item.generation === session.generation)

    return { lease, session, streamId, current, persistence: lease.client.persistence }
  }

  async refresh(sessionId: string) {
    const context = this.context(sessionId)
    const queue = await context.persistence.readQueue(sessionId)
    const items: QueuedPrompt[] = []
    const receipts = await readQueueReceipts(context.persistence, queue.intents)

    for (const { command, receipt } of receipts) {
      if (receipt?.status === CommandStatus.Dispatched || receipt?.status === CommandStatus.Rejected) continue
      const previous = this.store.getState().outbox.find((item) => item.command.commandId === command.commandId)
      const stale = command.generation !== context.session.generation

      const status =
        receipt?.status === CommandStatus.Unknown || previous?.status === PromptStatus.Unknown
          ? PromptStatus.Unknown
          : receipt?.status === CommandStatus.Accepted || previous?.status === PromptStatus.Accepted
            ? PromptStatus.Accepted
            : previous?.status === PromptStatus.Sending
              ? PromptStatus.Sending
              : previous?.status === PromptStatus.Editing
                ? PromptStatus.Editing
                : PromptStatus.Queued

      items.push({
        command,
        streamId: context.streamId,
        runtimeEpoch: context.lease.epoch,
        files: previous?.files ?? [],
        status: stale ? PromptStatus.Stale : status,
      })
    }

    if (!context.current() || queue.revision < (this.queues.get(sessionId)?.revision ?? 0)) return
    this.queues.set(sessionId, queue)
    this.store.setState((state) => ({ outbox: [...state.outbox.filter((item) => item.command.sessionId !== sessionId), ...items] }))
  }

  protected async save(sessionId: string, transform: (intents: ClientCommand[]) => ClientCommand[]) {
    if (this.busy.has(sessionId)) throw new Error(ErrorCode.IPC_BUSY)
    this.busy.add(sessionId)

    try {
      const context = this.context(sessionId)

      if (!this.queues.has(sessionId)) await this.refresh(sessionId)
      const before = this.queues.get(sessionId)

      if (!before) throw new Error(ErrorCode.STALE_SESSION)
      const intents = transform(before.intents)

      if (!context.current()) throw new Error(ErrorCode.STALE_SESSION)

      try {
        const saved = await context.persistence.saveQueue(sessionId, context.session.generation, before.revision, intents)

        if (!context.current()) throw new Error(ErrorCode.STALE_SESSION)
        this.queues.set(sessionId, saved)
        await this.refresh(sessionId)
      } catch (error) {
        if (error instanceof Error && error.message === ErrorCode.LOCAL_REVISION_CONFLICT) await this.refresh(sessionId)
        throw error
      }
    } finally {
      this.busy.delete(sessionId)
    }
  }

  start() {
    this.stopped = false

    return () => this.close()
  }

  close() {
    this.stopped = true
  }
}
