import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ErrorCode } from "@protocol"
import { deviceKeys } from "@/entities/device"
import { selectedSession, useSessionStoreApi } from "@/entities/session"
import { useRuntime } from "@/shared/lib/runtime"

export function useRenameSession() {
  const runtime = useRuntime()
  const store = useSessionStoreApi()
  const cache = useQueryClient()

  const mutation = useMutation({
    retry: false,
    onSuccess: () => cache.invalidateQueries({ queryKey: deviceKeys.all }),
    mutationFn: async (title: string) => {
      const lease = runtime.current()
      const source = selectedSession(store.getState().session)

      if (!lease || !source) throw new Error(ErrorCode.NO_AUTHENTICATED_CLIENT)

      await lease.client.renameSession(source.id, title.trim(), source.generation)

      if (!runtime.isCurrent(lease)) throw new Error(ErrorCode.STALE_SESSION)
    },
  })

  return { save: mutation.mutateAsync, busy: mutation.isPending }
}

export type RenameSessionController = ReturnType<typeof useRenameSession>
