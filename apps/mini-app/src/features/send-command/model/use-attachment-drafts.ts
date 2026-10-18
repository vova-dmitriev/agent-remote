import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ErrorCode, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_MESSAGE_ATTACHMENT_BYTES, type Session } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { PendingAttachmentStatus } from "../config/values"
import { createPendingAttachment } from "../lib/pending-attachment"
import { restoreAttachments } from "./persistence/restore-attachments"
import type { PendingAttachment } from "./attachment-types"

export function useAttachmentDrafts(selected: Session | undefined) {
  const runtime = useRuntime()
  const [drafts, setDrafts] = useState<Record<string, PendingAttachment[]>>({})
  const current = useRef(drafts)
  const transfers = useRef(new Map<string, AbortController>())
  const [error, setError] = useState("")

  const cache = useQueryClient()

  const mutation = useMutation({
    onSuccess: (descriptor, { session }) => cache.invalidateQueries({ queryKey: ["attachment", session.id, descriptor.id] }),
    retry: false,
    mutationFn: async ({ session, item, controller }: { session: Session; item: PendingAttachment; controller: AbortController }) => {
      const access = runtime.client?.attachments

      if (!access) throw new Error(ErrorCode.NO_AUTHENTICATED_CLIENT)

      return access.upload(session.id, session.generation, item.file, item.id, controller.signal, (progress) => {
        update(session.id, item.id, { progress })
      })
    },
  })

  function change(sessionId: string, transform: (items: PendingAttachment[]) => PendingAttachment[]) {
    const next = { ...current.current, [sessionId]: transform(current.current[sessionId] ?? []) }

    current.current = next
    setDrafts(next)
  }

  function update(sessionId: string, id: string, value: Partial<PendingAttachment>) {
    change(sessionId, (items) => items.map((item) => (item.id === id ? { ...item, ...value } : item)))
  }

  async function upload(session: Session, item: PendingAttachment) {
    const controller = new AbortController()

    transfers.current.set(item.id, controller)
    update(session.id, item.id, { status: PendingAttachmentStatus.Uploading, progress: 0, error: undefined })

    try {
      const descriptor = await mutation.mutateAsync({ session, item, controller })

      if (!controller.signal.aborted) update(session.id, item.id, { status: PendingAttachmentStatus.Ready, progress: 100, descriptor })
    } catch (reason) {
      if (!controller.signal.aborted)
        update(session.id, item.id, {
          status: PendingAttachmentStatus.Error,
          error: reason instanceof Error ? reason.message : ErrorCode.ATTACHMENT_UPLOAD_FAILED,
        })
    } finally {
      transfers.current.delete(item.id)
    }
  }

  function add(files: File[]) {
    if (!selected?.capabilities.attachments) return
    const previous = current.current[selected.id] ?? []
    const total = [...previous.map((item) => item.file), ...files]

    const invalid =
      total.length > MAX_ATTACHMENTS
        ? ErrorCode.ATTACHMENT_COUNT
        : total.some((file) => !file.size || file.size > MAX_ATTACHMENT_BYTES)
          ? ErrorCode.ATTACHMENT_TOO_LARGE
          : total.reduce((sum, file) => sum + file.size, 0) > MAX_MESSAGE_ATTACHMENT_BYTES
            ? ErrorCode.ATTACHMENTS_TOO_LARGE
            : ""

    setError(invalid)
    if (invalid) return

    const added = files.map(createPendingAttachment)

    change(selected.id, (items) => [...items, ...added])
    for (const item of added) void upload(selected, item)
  }

  function removeFrom(sessionId: string, ids: string[]) {
    const removed = new Set(ids)

    change(sessionId, (items) =>
      items.filter((item) => {
        if (!removed.has(item.id)) return true
        transfers.current.get(item.id)?.abort()
        transfers.current.delete(item.id)

        return false
      }),
    )
  }

  function remove(id: string) {
    if (selected) removeFrom(selected.id, [id])
  }

  async function retry(id: string) {
    const item = selected && current.current[selected.id]?.find((candidate) => candidate.id === id)

    if (!selected || !item) return
    if (item.reference && runtime.client?.attachments) {
      const controller = new AbortController()
      const lease = runtime.current()

      transfers.current.set(id, controller)

      try {
        const restored = await restoreAttachments(runtime.client.attachments, selected.id, [item.reference], controller.signal)

        if (runtime.isCurrent(lease) && !controller.signal.aborted)
          change(selected.id, (items) => items.map((current) => (current.id === id ? restored[0]! : current)))
      } finally {
        transfers.current.delete(id)
      }
    } else void upload(selected, item)
  }

  const reset = useCallback(() => {
    for (const controller of transfers.current.values()) controller.abort()
    transfers.current.clear()
    current.current = {}
    setDrafts({})
    setError("")
  }, [])

  useEffect(() => reset, [reset])

  const items = selected ? (drafts[selected.id] ?? []) : []

  return {
    items,
    error,
    add,
    remove,
    retry: (id: string) => {
      void retry(id).catch(() => {})
    },
    reset,
    complete: removeFrom,
    restore: (sessionId: string, items: PendingAttachment[]) => change(sessionId, () => items),
    ready: items.every((item) => item.status === PendingAttachmentStatus.Ready),
  }
}
