import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ErrorCode, type SessionRemoval } from "@protocol"
import { deviceKeys } from "@/entities/device"
import { selectedSession, useSessionStoreApi } from "@/entities/session"
import { useRuntime } from "@/shared/lib/runtime"

/** Removes the selected session from the lists; the device's next snapshot leaves it out. */
export function useRemoveSession() {
  const runtime = useRuntime()
  const store = useSessionStoreApi()
  const cache = useQueryClient()

  const mutation = useMutation({
    retry: false,
    // A removed session leaves its device's session count.
    onSuccess: () => cache.invalidateQueries({ queryKey: deviceKeys.all }),
    mutationFn: async (mode: SessionRemoval) => {
      const lease = runtime.current()
      const source = selectedSession(store.getState().session)

      if (!lease || !source) throw new Error(ErrorCode.NO_AUTHENTICATED_CLIENT)

      await lease.client.removeSession(source.id, source.generation, mode)
    },
  })

  return { remove: mutation.mutateAsync, busy: mutation.isPending, failed: mutation.isError }
}

export type RemoveSessionController = ReturnType<typeof useRemoveSession>
