import { createContext } from "react"

/** Opens a local image path from a message; absent, such a path stays plain text. */
export const LocalPathContext = createContext<((path: string) => void) | undefined>(undefined)

export const LocalPathProvider = LocalPathContext.Provider
