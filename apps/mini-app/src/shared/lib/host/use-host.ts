import { useContext } from "react"
import { HostContext } from "./context"

export const useHost = () => useContext(HostContext)
