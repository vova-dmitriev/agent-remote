import type { ClipboardEvent, DragEvent } from "react"
import type { CommandController } from "./use-command"

export function useComposerAttachments(controller: CommandController, enabled: boolean) {
  function onDragOver(event: DragEvent<HTMLFormElement>) {
    if (enabled) event.preventDefault()
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    if (!enabled) return
    event.preventDefault()
    controller.attachments.add(Array.from(event.dataTransfer.files))
  }

  function onPaste(event: ClipboardEvent<HTMLFormElement>) {
    if (!enabled) return
    const images = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"))

    if (images.length) {
      event.preventDefault()
      controller.attachments.add(images)
    }
  }

  return { onDragOver, onDrop, onPaste }
}
