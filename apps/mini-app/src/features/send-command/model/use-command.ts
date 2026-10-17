import { useCallback, type FormEvent } from "react"
import { CommandActionType, ErrorCode, validatePrompt, type ClientCommand } from "@protocol"
import { canQueuePrompt, selectedSession, useSessionStore, useSessionStoreApi } from "@/entities/session"
import { useAttachmentDrafts } from "./use-attachment-drafts"
import { useSessionDrafts } from "./use-session-drafts"
import { useControls } from "./controls/use-controls"
import { usePromptOutbox } from "./outbox/use-prompt-outbox"
import { isUncertainCommand } from "../lib/notice"

export function useCommand() {
  const store = useSessionStoreApi()
  const selected = useSessionStore((state) => selectedSession(state.session))
  const drafts = useSessionDrafts(selected?.id)
  const attachments = useAttachmentDrafts(selected)
  const controls = useControls(selected)
  const outbox = usePromptOutbox(selected?.id)
  const { reset: resetDrafts } = drafts
  const { reset: resetAttachments } = attachments
  const { reset: resetControls } = controls

  function submit(event: FormEvent) {
    event.preventDefault()
    const state = store.getState()
    const source = selectedSession(state.session)
    const lease = state.runtime.current()

    if (!source || !lease || !state.session.snapshot || !attachments.ready) return
    if (
      source.id !== selected?.id ||
      source.generation !== selected.generation ||
      !canQueuePrompt(state.session.connection, state.session.snapshot.deviceStatus, source)
    )
      return

    try {
      if (drafts.prompt.trim() || !attachments.items.length) validatePrompt(drafts.prompt)
      const descriptors = attachments.items.flatMap((item) => (item.descriptor ? [item.descriptor] : []))

      const command: ClientCommand = {
        commandId: crypto.randomUUID(),
        target: source.target,
        sessionId: source.id,
        generation: source.generation,
        action: { type: CommandActionType.Prompt, text: drafts.prompt, ...(descriptors.length ? { attachments: descriptors } : {}) },
      }

      const queued = state.enqueuePrompt({
        command,
        streamId: state.session.snapshot.cursor.streamId,
        runtimeEpoch: lease.epoch,
        files: attachments.items.map((item) => item.file),
      })

      if (!queued) {
        state.setError(ErrorCode.PROMPT_OUTBOX_FULL)

        return
      }

      drafts.clear(source.id, drafts.prompt)

      attachments.complete(
        source.id,
        attachments.items.map((item) => item.id),
      )

      if (!isUncertainCommand(state.error)) state.setError("")
    } catch (error) {
      state.setError(error instanceof Error ? error.message : ErrorCode.INVALID_PROMPT)
    }
  }

  const reset = useCallback(() => {
    resetDrafts()
    resetAttachments()
    resetControls()
  }, [resetDrafts, resetAttachments, resetControls])

  return { ...controls, prompt: drafts.prompt, setPrompt: drafts.setPrompt, attachments, outbox, submit, reset }
}

export type CommandController = ReturnType<typeof useCommand>
