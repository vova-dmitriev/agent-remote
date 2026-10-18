import { useCallback, useRef, type FormEvent } from "react"
import { CommandActionType, ErrorCode, validatePrompt, type ClientCommand } from "@protocol"
import { canQueuePrompt, selectedSession, useSessionStore, useSessionStoreApi } from "@/entities/session"
import { useAttachmentDrafts } from "./use-attachment-drafts"
import { useSessionDrafts } from "./use-session-drafts"
import { usePersistedDraft } from "./persistence/use-persisted-draft"
import { useControls } from "./controls/use-controls"
import { usePromptOutbox } from "./outbox/use-prompt-outbox"
import { isUncertainCommand } from "../lib/notice"

export function useCommand() {
  const store = useSessionStoreApi()
  const submitting = useRef(false)
  const selected = useSessionStore((state) => selectedSession(state.session))
  const drafts = useSessionDrafts(selected?.id)
  const attachments = useAttachmentDrafts(selected)
  const persisted = usePersistedDraft(selected, drafts, attachments)
  const controls = useControls(selected)
  const outbox = usePromptOutbox(selected?.id)
  const { reset: resetDrafts } = drafts
  const { reset: resetAttachments } = attachments
  const { reset: resetControls } = controls

  function submit(event: FormEvent) {
    void submitQueued(event)
  }

  async function submitQueued(event: FormEvent) {
    event.preventDefault()
    const state = store.getState()
    const source = selectedSession(state.session)
    const lease = state.runtime.current()

    if (!source || !lease || !state.session.snapshot || !attachments.ready || !persisted.ready || submitting.current) return
    if (
      source.id !== selected?.id ||
      source.generation !== selected.generation ||
      !canQueuePrompt(state.session.connection, state.session.snapshot.deviceStatus, source)
    )
      return

    submitting.current = true

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

      const intent = {
        command,
        streamId: state.session.snapshot.cursor.streamId,
        runtimeEpoch: lease.epoch,
        files: attachments.items.map((item) => item.file),
      }

      if (lease.client.persistence) await persisted.flush()
      const queued = outbox.enqueue ? await outbox.enqueue(intent) : state.enqueuePrompt(intent)

      if (!queued) {
        state.setError(ErrorCode.PROMPT_OUTBOX_FULL)

        return
      }

      if (lease.client.persistence) await persisted.refresh()
      if (!state.runtime.isCurrent(lease)) return
      drafts.clear(source.id, drafts.prompt)

      attachments.complete(
        source.id,
        attachments.items.map((item) => item.id),
      )

      if (!isUncertainCommand(state.error)) state.setError("")
    } catch (error) {
      state.setError(error instanceof Error ? error.message : ErrorCode.INVALID_PROMPT)
    } finally {
      submitting.current = false
    }
  }

  const reset = useCallback(() => {
    resetDrafts()
    resetAttachments()
    resetControls()
  }, [resetDrafts, resetAttachments, resetControls])

  const { restore: _restore, ...composerAttachments } = attachments

  return {
    ...controls,
    prompt: drafts.prompt,
    setPrompt: drafts.setPrompt,
    attachments: {
      ...composerAttachments,
      ready: composerAttachments.ready && persisted.ready,
      ...(outbox.enqueue ? { restoring: !persisted.ready } : {}),
    },
    outbox,
    submit,
    reset,
  }
}

export type CommandController = ReturnType<typeof useCommand>
