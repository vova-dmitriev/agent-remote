import { createContext } from "react"
import type { StoreApi } from "zustand"
import type { SessionStoreState } from "../store/types"

export const SessionContext = createContext<StoreApi<SessionStoreState> | null>(null)
