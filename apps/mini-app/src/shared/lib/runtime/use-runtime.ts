import { useContext } from "react"
import { ErrorCode } from "@protocol"
import { RuntimeContext } from "./context"

export function useRuntime() {
  const runtime = useContext(RuntimeContext)

  if (!runtime) throw new Error(ErrorCode.APPLICATION_PROVIDER_REQUIRED)

  return runtime
}
