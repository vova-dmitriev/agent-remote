import { createContext } from "react"
import { telegramHost } from "./telegram-host"

export const HostContext = createContext(telegramHost)
