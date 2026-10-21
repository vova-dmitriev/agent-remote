import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import { ControlStatus } from "@/features/send-command/config/values"
import {
  CommandActionType,
  CommandStatus,
  ConnectionStatus,
  ErrorCode,
  type ClientCommand,
  type CommandResult,
  type Session,
} from "@protocol"
import { PROMPT_RECEIPT_POLL_MS, useSessionStore, useSessionStoreApi } from "@/entities/session"
import { useRuntime } from "@/shared/lib/runtime"
import type { PendingControl } from "./types"
import { controlState } from "./context-state"

export function useControls(selected: Session | undefined) {
  const runtime = useRuntime()
  const store = useSessionStoreApi()
  const receipt = useSessionStore((state) => state.commandResult)
  const pending = useRef(new Map<string, PendingControl>())
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null)
  const [busySession, setBusySession] = useState<string | null>(null)
  const retryId = useRef<string | null>(null)
  const epoch = useRef(0)

  function unknown(entry: PendingControl) {
    entry.status = ControlStatus.Unknown
    retryId.current = entry.command.commandId

    store
      .getState()
      .setError(
        entry.command.action.type === CommandActionType.UserInput ? ErrorCode.QUESTION_STATUS_UNKNOWN : ErrorCode.COMMAND_STATUS_UNKNOWN,
      )
  }

  function complete(response: CommandResult) {
    const entry = pending.current.get(response.commandId)

    if (!entry) return

    if (response.status === CommandStatus.Unknown) {
      unknown(entry)

      return
    }

    if (response.status === CommandStatus.Accepted) {
      if (entry.status !== ControlStatus.Unknown) entry.status = ControlStatus.Accepted

      return
    }

    pending.current.delete(response.commandId)

    if (retryId.current === response.commandId) {
      retryId.current = null
      store.getState().setError("")
    }

    store.getState().setResult(response.code ?? response.status)
    if (response.status === CommandStatus.Rejected) store.getState().setError(response.code ?? ErrorCode.COMMAND_DELIVERY_FAILED)
    if (response.status === CommandStatus.Dispatched && response.sessionId && entry.command.action.type === CommandActionType.CreateSession)
      setCreatedSessionId(response.sessionId)
  }

  const observeReceipt = useEffectEvent(complete)

  useEffect(() => {
    if (receipt) observeReceipt(receipt)
  }, [receipt])

  const checkAccepted = useEffectEvent(async () => {
    const lease = runtime.current()
    const localEpoch = epoch.current

    if (!lease || store.getState().session.connection !== ConnectionStatus.Online) return

    for (const entry of pending.current.values()) {
      if (entry.runtimeEpoch !== lease.epoch) {
        pending.current.delete(entry.command.commandId)

        continue
      }
    }

    await Promise.all(
      [...pending.current.values()]
        .filter((entry) => entry.status === ControlStatus.Accepted)
        .map(async (entry) => {
          try {
            const response = await lease.client.checkPending(entry.command.commandId)

            if (runtime.isCurrent(lease) && epoch.current === localEpoch) complete(response)
          } catch {
            /* A failed read does not change the known accepted receipt. */
          }
        }),
    )
  })

  useEffect(() => {
    const timer = setInterval(() => void checkAccepted(), PROMPT_RECEIPT_POLL_MS)

    return () => clearInterval(timer)
  }, [])

  async function execute(entry: PendingControl, retry = false) {
    const lease = runtime.current()
    const localEpoch = epoch.current

    if (!lease) return

    if (entry.runtimeEpoch !== lease.epoch) {
      pending.current.delete(entry.command.commandId)
      store.getState().setError(ErrorCode.STALE_SESSION)

      return
    }

    setBusySession(entry.command.sessionId)

    try {
      const response = await (retry ? lease.client.retryPending(entry.command.commandId) : lease.client.send(entry.command))

      if (runtime.isCurrent(lease) && epoch.current === localEpoch) complete(response)
    } catch (error) {
      if (!runtime.isCurrent(lease) || epoch.current !== localEpoch) return
      const code = error instanceof Error ? error.message : ErrorCode.COMMAND_DELIVERY_FAILED

      if ([ErrorCode.COMMAND_STATUS_UNKNOWN, ErrorCode.COMMAND_PENDING_STATUS].some((candidate) => candidate === code)) unknown(entry)
      else {
        pending.current.delete(entry.command.commandId)
        store.getState().setError(code)
      }
    } finally {
      if (runtime.isCurrent(lease) && epoch.current === localEpoch) setBusySession(null)
    }
  }

  async function action(value: ClientCommand["action"], source = selected) {
    const lease = runtime.current()

    if (!source || value.type === CommandActionType.Prompt || !lease) return
    const key = JSON.stringify([source.target.deviceId, source.id, source.generation, value])
    const existing = [...pending.current.values()].find((entry) => entry.key === key)

    if (existing) {
      if (existing.status === ControlStatus.Unknown) unknown(existing)

      return
    }

    const command: ClientCommand = {
      commandId: crypto.randomUUID(),
      target: source.target,
      sessionId: source.id,
      generation: source.generation,
      action: value,
    }

    const entry: PendingControl = { command, key, runtimeEpoch: lease.epoch, status: ControlStatus.Sending }

    pending.current.set(command.commandId, entry)
    store.getState().setError("")
    await execute(entry)
  }

  async function retry() {
    const entry = retryId.current && pending.current.get(retryId.current)

    if (entry) await execute(entry, true)
  }

  const reset = useCallback(() => {
    epoch.current++
    pending.current.clear()
    retryId.current = null
    setCreatedSessionId(null)
    setBusySession(null)
  }, [])

  return {
    action,
    retry,
    reset,
    createdSessionId,
    busy: busySession !== null && (!selected || busySession === selected.id),
    ...controlState(pending.current.values(), selected?.id, runtime.epoch, selected?.generation),
    consumeCreatedSession: useCallback(() => setCreatedSessionId(null), []),
    /** Opens a session started outside a command (in a device's project) once the snapshot has it. */
    openCreatedSession: setCreatedSessionId,
  }
}
