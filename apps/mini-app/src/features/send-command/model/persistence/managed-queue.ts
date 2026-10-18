import { CommandActionType, ErrorCode, PromptDelivery, validatePrompt, type ClientCommand } from "@protocol"
import { PromptStatus, canSendQueuedNow, type SessionStoreState } from "@/entities/session"
import { QueueState } from "./queue/state"

export class ManagedQueue extends QueueState {
  private unconfirmed = new Map<string, ClientCommand>()
  override start() {
    this.unconfirmed.clear()

    return super.start()
  }

  async enqueue(item: Parameters<SessionStoreState["enqueuePrompt"]>[0]) {
    const pending = this.unconfirmed.get(item.command.sessionId)

    if (pending) {
      const context = this.context(item.command.sessionId)
      const queue = await context.persistence.readQueue(item.command.sessionId)
      const receipt = await context.persistence.readReceipt(pending.commandId)

      if (!context.current()) throw new Error(ErrorCode.STALE_SESSION)
      if (!queue.intents.some((entry) => entry.commandId === pending.commandId) && !receipt)
        throw new Error(ErrorCode.COMMAND_STATUS_UNKNOWN)
      this.unconfirmed.delete(item.command.sessionId)
      await this.refresh(item.command.sessionId)
      if (JSON.stringify(pending.action) === JSON.stringify(item.command.action) && pending.generation === item.command.generation)
        return true
    }

    this.unconfirmed.set(item.command.sessionId, item.command)

    try {
      await this.refresh(item.command.sessionId)
      await this.save(item.command.sessionId, (intents) => [...intents, item.command])
      this.unconfirmed.delete(item.command.sessionId)

      return true
    } catch (error) {
      const uncertain = [
        ErrorCode.NETWORK_UNAVAILABLE,
        ErrorCode.REQUEST_TIMEOUT,
        ErrorCode.IPC_CLOSED,
        ErrorCode.LOCAL_HOST_UNAVAILABLE,
        ErrorCode.COMMAND_STATUS_UNKNOWN,
        ErrorCode.UNKNOWN_AFTER_WRITE,
      ].some((code) => error instanceof Error && error.message === code)

      if (!uncertain) this.unconfirmed.delete(item.command.sessionId)
      throw error
    }
  }

  async cancel(id: string) {
    const item = this.item(id, [PromptStatus.Queued, PromptStatus.Editing, PromptStatus.Failed, PromptStatus.Stale])

    await this.save(item.command.sessionId, (intents) => intents.filter((command) => command.commandId !== id))
  }

  async saveEdit(id: string, text: string) {
    const item = this.item(id, [PromptStatus.Editing])

    validatePrompt(text)
    if (item.command.action.type !== CommandActionType.Prompt) return false
    const command: ClientCommand = { ...item.command, action: { ...item.command.action, text } }

    await this.save(item.command.sessionId, (intents) => {
      if (!intents.some((entry) => entry.commandId === id)) throw new Error(ErrorCode.STALE_SESSION)

      return intents.map((entry) => (entry.commandId === id ? command : entry))
    })

    this.store.getState().cancelPromptEdit(id)

    return true
  }

  canSendNow(id: string) {
    return canSendQueuedNow(this.store.getState(), id) && !this.busy.has(this.itemSession(id))
  }

  async sendNow(id: string) {
    const item = this.item(id, [PromptStatus.Queued])
    const context = this.context(item.command.sessionId)

    if (!this.canSendNow(id) || item.command.action.type !== CommandActionType.Prompt) return
    const command = { ...item.command, action: { ...item.command.action, delivery: PromptDelivery.Immediate } }

    this.store.getState().updatePrompt(id, PromptStatus.Sending)

    try {
      const result = await context.lease.client.send(command)

      if (context.current()) this.store.getState().finishPrompt(result)
    } catch (error) {
      if (context.current()) this.store.getState().updatePrompt(id, PromptStatus.Unknown, ErrorCode.COMMAND_STATUS_UNKNOWN)
      throw error
    }
  }

  async check(id: string) {
    const item = this.item(id, [PromptStatus.Unknown, PromptStatus.Accepted])
    const context = this.context(item.command.sessionId)
    const result = await context.persistence.readReceipt(id)

    if (result && context.current()) this.store.getState().finishPrompt(result)
  }

  private itemSession(id: string) {
    return this.store.getState().outbox.find((entry) => entry.command.commandId === id)?.command.sessionId ?? ""
  }

  private item(id: string, statuses: PromptStatus[]) {
    const item = this.store.getState().outbox.find((entry) => entry.command.commandId === id)

    if (!item || !statuses.includes(item.status)) throw new Error(ErrorCode.STALE_SESSION)

    return item
  }
}
