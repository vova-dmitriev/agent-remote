import { useContext } from "react"
import { HostContext } from "./context"

export function useHost() {
  const host = useContext(HostContext)

  if (!host) throw new Error("HostContext provider is missing")

  return host
}
