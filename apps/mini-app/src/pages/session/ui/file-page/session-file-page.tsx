import { FileViewStatus } from "@/pages/session/config/file-view"
import { useSessionFile } from "@/pages/session/model/file/use-session-file"
import { FileView } from "./file-view"
import { useTelegramBackButton } from "@/shared/lib/telegram"
import type { SessionFilePageProps } from "./session-file-page.types"

/** A file the session changed, read from its device when opened. */
export function SessionFilePage({ session, path, onBack }: SessionFilePageProps) {
  const { state, retry } = useSessionFile(session, path)

  useTelegramBackButton(onBack)

  return (
    <FileView
      path={path}
      status={state.status}
      file={state.status === FileViewStatus.Ready ? state.file : undefined}
      error={state.status === FileViewStatus.Failed ? state.code : undefined}
      onBack={onBack}
      onRetry={retry}
    />
  )
}
