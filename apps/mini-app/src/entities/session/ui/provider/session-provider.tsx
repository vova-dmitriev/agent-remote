import { useState } from "react"
import { RuntimeContext } from "@/shared/lib/runtime"
import { createSessionStore } from "@/entities/session/model/store"
import { SessionContext } from "@/entities/session/model/context/session-context"
import type { SessionProviderProps } from "./session-provider.types"

export function SessionProvider({ children }: SessionProviderProps) {
  const [store] = useState(createSessionStore)

  return (
    <SessionContext.Provider value={store}>
      <RuntimeContext.Provider value={store.getState().runtime}>{children}</RuntimeContext.Provider>
    </SessionContext.Provider>
  )
}
