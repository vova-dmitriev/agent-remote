import { useContext, useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { I18nContext } from "react-i18next"
import { ConnectionStatus, ErrorCode } from "@protocol"
import { loadPreferences, savePreferences } from "@/shared/api"
import { useSessionStore } from "@/entities/session"
import { useRuntime } from "@/shared/lib/runtime"
import { PreferenceSync, preferenceStorage, subscribePreferences } from "@/shared/lib/preferences"
import { telegram } from "@/shared/lib/telegram"
import { ThemeContext } from "@/shared/lib/theme"
import type { PreferenceMutationInput } from "./preferences.types"

export function useAccountPreferences() {
  const runtime = useRuntime()
  const connection = useSessionStore((state) => state.session.connection)
  const { i18n } = useContext(I18nContext)
  const { restorePreference } = useContext(ThemeContext)
  const cache = useQueryClient()
  const sync = useRef<PreferenceSync | null>(null)
  const [hydratedEpoch, setHydratedEpoch] = useState<number | null>(null)
  const [saveError, setSaveError] = useState("")

  const { mutateAsync } = useMutation({
    mutationFn: ({ lease, patch }: PreferenceMutationInput) => savePreferences(lease.client, patch),
    retry: false,
    onSuccess: (preferences, { lease }) => {
      if (runtime.isCurrent(lease)) cache.setQueryData(["preferences", lease.epoch], preferences)
    },
  })

  const query = useQuery({
    queryKey: ["preferences", runtime.epoch],
    queryFn: () => {
      if (!runtime.client) throw new Error(ErrorCode.UNAUTHORIZED)

      return loadPreferences(runtime.client)
    },
    enabled: connection === ConnectionStatus.Online,
    retry: false,
    staleTime: Infinity,
  })

  useEffect(() => {
    const lease = runtime.current()
    const generation = runtime.epoch
    const active = () => runtime.isCurrent(lease)

    const instance = new PreferenceSync({
      ...preferenceStorage(telegram()?.initData ?? ""),
      apply: (patch) => {
        if (!active()) return
        if (patch.language) void i18n.changeLanguage(patch.language)
        if (patch.theme) restorePreference(patch.theme)
      },
      save: (patch) => {
        if (!lease || !active()) return Promise.reject(new Error(ErrorCode.UNAUTHORIZED))

        return mutateAsync({ lease, patch })
      },
      ready: () => {
        if (active()) setHydratedEpoch(generation)
      },
      error: (value) => {
        if (active()) setSaveError(value)
      },
    })

    sync.current = instance

    const unsubscribe = subscribePreferences((patch) => {
      if (active()) instance.change(patch)
    })

    return () => {
      unsubscribe()
      instance.close()
      sync.current = null
    }
  }, [runtime, i18n, mutateAsync, restorePreference])

  useEffect(() => {
    sync.current?.setOnline(connection === ConnectionStatus.Online)

    if (query.data) {
      sync.current?.hydrate(query.data)
    }
  }, [connection, query.data, runtime])

  return {
    ready: connection === ConnectionStatus.Expired || query.isError || hydratedEpoch === runtime.epoch,
    error: connection === ConnectionStatus.Expired ? "" : saveError || (query.error ? ErrorCode.PREFERENCES_LOAD_FAILED : ""),
  }
}
