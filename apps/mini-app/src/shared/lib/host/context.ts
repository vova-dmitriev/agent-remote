import { createContext } from "react"
import type { HostAdapter } from "./types"

export const HostContext = createContext<HostAdapter | null>(null)
