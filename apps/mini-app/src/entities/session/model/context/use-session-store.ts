import { useContext } from "react"
import { useStore } from "zustand"
import { ErrorCode } from "@protocol"
import type { SessionStoreState } from "../store/types"
import { SessionContext } from "./session-context"

export function useSessionStoreApi() {
  const store = useContext(SessionContext)

  if (!store) throw new Error(ErrorCode.SESSION_PROVIDER_REQUIRED)

  return store
}

export function useSessionStore<T>(selector: (state: SessionStoreState) => T) {
  return useStore(useSessionStoreApi(), selector)
}
