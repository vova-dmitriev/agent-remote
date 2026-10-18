import type { ReactNode } from "react"
import type { ProviderFilterValue } from "@protocol"

export interface SessionProviderProps {
  children: ReactNode
  initialProviderFilter?: ProviderFilterValue
}
