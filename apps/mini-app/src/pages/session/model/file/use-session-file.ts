import { useEffect, useState } from "react"
import { ErrorCode, type Session, type SessionFile } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { FileViewStatus } from "@/pages/session/config/file-view"

type FileState =
  | { status: typeof FileViewStatus.Loading }
  | { status: typeof FileViewStatus.Ready; file: SessionFile }
  | { status: typeof FileViewStatus.Failed; code: string }

const LOADING: FileState = { status: FileViewStatus.Loading }

/** Reads one file the session changed from its device; `retry` reads it again. */
export function useSessionFile(session: Session, path: string) {
  const runtime = useRuntime()
  const [state, setState] = useState<FileState>(LOADING)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    const client = runtime.current()?.client
    const read = client ? client.readSessionFile(session.id, session.generation, path) : Promise.reject(new Error(ErrorCode.DEVICE_OFFLINE))

    read.then(
      (file) => current && setState({ status: FileViewStatus.Ready, file }),
      (error: unknown) =>
        current && setState({ status: FileViewStatus.Failed, code: error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED }),
    )

    return () => {
      current = false
    }
  }, [runtime, session.id, session.generation, path, attempt])

  const retry = () => {
    setState(LOADING)
    setAttempt((value) => value + 1)
  }

  return { state, retry }
}
