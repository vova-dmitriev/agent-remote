import { createContext } from "react"
import { ThemePreference } from "@protocol"

export const ThemeContext = createContext<{
  preference: ThemePreference
  restorePreference: (value: ThemePreference) => void
  setPreference: (value: ThemePreference) => void
}>({ preference: ThemePreference.Auto, restorePreference: () => {}, setPreference: () => {} })
