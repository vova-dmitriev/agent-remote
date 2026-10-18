import { useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ErrorCode } from "@protocol"
import { deviceKeys } from "@/entities/device"
import { useSessionStoreApi } from "@/entities/session"
import { useRuntime } from "@/shared/lib/runtime"
import type { PairDeviceInput } from "./types"

export function usePairDevice() {
  const runtime = useRuntime()
  const { setError, setResult } = useSessionStoreApi().getState()
  const [code, setCode] = useState("")
  const cache = useQueryClient()

  const mutation = useMutation({
    mutationFn: async ({ value, lease }: PairDeviceInput) => {
      if (!runtime.isCurrent(lease)) throw new Error(ErrorCode.NO_AUTHENTICATED_CLIENT)
      await lease.client.claimDevice(value.trim())

      return lease
    },
    onSuccess: (lease) => {
      if (!runtime.isCurrent(lease)) return
      setCode("")
      void cache.invalidateQueries({ queryKey: deviceKeys.all })
      setResult(ErrorCode.PAIRING_CONFIRM_LOCAL)
    },
    retry: false,
  })

  async function submit(event: FormEvent) {
    event.preventDefault()
    const lease = runtime.current()

    setError("")
    if (!lease) return setError(ErrorCode.NO_AUTHENTICATED_CLIENT)

    try {
      await mutation.mutateAsync({ value: code, lease })
    } catch (error) {
      if (runtime.isCurrent(lease)) setError(error instanceof Error ? error.message : ErrorCode.PAIRING_FAILED)
    }
  }

  return { code, setCode, submit, busy: mutation.isPending, reset: () => setCode("") }
}
