import type { StoreApi } from "zustand/vanilla"
import { CommandActionType, ErrorCode, validatePrompt } from "@protocol"
import type { SessionStoreState } from "../types"
import { PromptStatus } from "./constants"
import { samePromptSource } from "./state"

export function createPromptEditing(set: StoreApi<SessionStoreState>["setState"], get: StoreApi<SessionStoreState>["getState"]) {
  const editable = (id: string, status: PromptStatus) => {
    const state = get()
    const item = state.outbox.find((entry) => entry.command.commandId === id)

    return item?.status === status && samePromptSource(item, state, state.runtime.epoch) ? item : undefined
  }

  return {
    beginPromptEdit: (id: string) => {
      if (!editable(id, PromptStatus.Queued)) return false
      get().updatePrompt(id, PromptStatus.Editing)

      return true
    },
    savePromptEdit: (id: string, text: string) => {
      const item = editable(id, PromptStatus.Editing)

      if (!item || item.command.action.type !== CommandActionType.Prompt) return false
      validatePrompt(text)
      if (!text.trim() && !item.command.action.attachments?.length) throw new Error(ErrorCode.INVALID_PROMPT)
      const command = { ...item.command, action: { ...item.command.action, text } }

      set((state) => ({
        outbox: state.outbox.map((entry) => (entry === item ? { ...entry, command, status: PromptStatus.Queued } : entry)),
      }))

      return true
    },
    cancelPromptEdit: (id: string) => {
      if (editable(id, PromptStatus.Editing)) get().updatePrompt(id, PromptStatus.Queued)
    },
  }
}
