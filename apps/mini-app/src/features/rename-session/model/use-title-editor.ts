import { useState, type FormEvent } from "react"
import { ErrorCode } from "@protocol"
import type { RenameSessionController } from "./use-rename-session"

export function useTitleEditor(title: string, controller: RenameSessionController) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(title)
  const [error, setError] = useState("")

  function changeOpen(next: boolean) {
    if (controller.busy) return

    if (next) {
      setValue(title)
      setError("")
    }

    setOpen(next)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!value.trim() || controller.busy) return
    setError("")

    try {
      await controller.save(value)
      setOpen(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : ErrorCode.INVALID_REQUEST)
    }
  }

  return { open, changeOpen, value, setValue, error, submit }
}
