import { useState, type SyntheticEvent } from "react"
import { CommandActionType, ErrorCode } from "@protocol"
import type { QueuedPromptEditorOptions } from "./queued-prompt-editor.types"

export function useQueuedPromptEditor({ item, queue }: QueuedPromptEditorOptions) {
  const [text, setText] = useState(() => (item.command.action.type === CommandActionType.Prompt ? item.command.action.text : ""))
  const [error, setError] = useState("")
  const id = item.command.commandId

  function change(value: string) {
    setText(value)
    setError("")
  }

  async function save() {
    try {
      if (!(await queue.saveEdit(id, text))) setError(ErrorCode.STALE_SESSION)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : ErrorCode.INVALID_PROMPT)
    }
  }

  function isolateEditor(event: SyntheticEvent) {
    event.stopPropagation()
  }

  return { text, error, change, save, cancel: () => queue.cancelEdit(id), isolateEditor }
}
