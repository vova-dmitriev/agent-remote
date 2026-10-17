import { createContext } from "react"
import type { TransportRuntime } from "./transport-runtime"

export const RuntimeContext = createContext<TransportRuntime | null>(null)
