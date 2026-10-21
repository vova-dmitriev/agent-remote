import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ConnectionStatus } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { selectedSession, useSessionConnection, useSessionSelection, useSessionStoreApi } from "@/entities/session"
import { useDevices } from "@/entities/device"
import { useRenameSession } from "@/features/rename-session"
import { useRemoveSession } from "@/features/remove-session"
import { useSwitchModel } from "@/features/switch-model"
import { useCommand } from "@/features/send-command"
import { usePairDevice } from "@/features/pair-device"
import { useRevokeDevice } from "@/features/device-access"
import { useAccountPreferences } from "./use-account-preferences"

export function useApplication() {
  const connection = useSessionConnection()
  const runtime = useRuntime()
  const { resetDeviceState } = useSessionStoreApi().getState()
  const { state, setError, setResult } = connection
  const preferences = useAccountPreferences()
  const selected = selectedSession(state)
  const rename = useRenameSession()
  const remove = useRemoveSession()
  const switchModel = useSwitchModel()
  const cache = useQueryClient()

  const deviceQuery = useDevices(state.connection === ConnectionStatus.Online)
  const devices = deviceQuery.data ?? []
  const firstDevice = devices[0]?.id
  const linkedSession = useRef<string | null | undefined>(undefined)
  /** A session link (the bot's Open session button) waits for the snapshot; the app shows the chat loading meanwhile. */
  const [linkPending, setLinkPending] = useState(() => new URLSearchParams(window.location.hash.slice(1)).has("session"))

  const selection = useSessionSelection()
  const commands = useCommand()
  const resetCommands = commands.reset
  const { createdSessionId, consumeCreatedSession } = commands

  useEffect(() => {
    const created = state.snapshot?.sessions.find((session) => session.id === createdSessionId)

    if (!created || state.connection !== ConnectionStatus.Online) return
    consumeCreatedSession()
    if (created.id !== state.selectedId) void selection.select(created)
  }, [createdSessionId, consumeCreatedSession, state.snapshot, state.connection, state.selectedId, selection])

  useEffect(() => {
    if (state.connection === ConnectionStatus.Expired) {
      resetCommands()
      cache.clear()
    }
  }, [state.connection, resetCommands, cache])

  const pairing = usePairDevice()
  const revoke = useRevokeDevice(resetDevice)

  function resetDevice() {
    commands.reset()
    cache.clear()
    selection.back(null)
    runtime.client?.resetTarget()
    setError("")
    setResult("")
    resetDeviceState()
  }

  useEffect(() => {
    if (firstDevice && firstDevice !== state.deviceId) runtime.client?.selectTarget(firstDevice, null)
  }, [runtime, firstDevice, state.deviceId])

  useEffect(() => {
    if (linkedSession.current === undefined) linkedSession.current = new URLSearchParams(window.location.hash.slice(1)).get("session")

    const session = state.snapshot?.sessions.find((item) => item.id === linkedSession.current)

    // A link to a session the snapshot does not have (gone, or another device's) falls back to the list.
    if (state.snapshot && !session) setLinkPending(false)
    if (!session || state.connection !== ConnectionStatus.Online) return
    linkedSession.current = null
    void selection.select(session)
    setLinkPending(false)

    const hash = new URLSearchParams(window.location.hash.slice(1))

    hash.delete("session")
    window.history.replaceState(null, "", window.location.pathname + window.location.search + (hash.size ? "#" + hash.toString() : ""))
  }, [selection, state.connection, state.snapshot])

  async function logout() {
    commands.reset()
    pairing.reset()
    const completion = connection.logout()

    cache.clear()
    await completion
  }

  return {
    ...connection,
    error: connection.error || preferences.error || deviceQuery.error?.message || "",
    preferencesReady: preferences.ready,
    selected,
    devices,
    selection,
    commands,
    rename,
    remove,
    switchModel,
    pairing,
    revoke,
    logout,
    linkPending: linkPending && state.connection !== ConnectionStatus.Expired,
    // Until the first snapshot an empty list is not known to be empty.
    loading:
      state.connection === ConnectionStatus.Connecting ||
      (state.connection === ConnectionStatus.Online && (deviceQuery.isPending || (devices.length > 0 && !state.snapshot))),
  }
}
