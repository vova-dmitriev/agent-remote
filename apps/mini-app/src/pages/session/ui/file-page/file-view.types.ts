import type { SessionFile } from "@protocol"
import type { FileViewStatus } from "@/pages/session/config/file-view"

export interface FileViewProps {
  path: string
  status: FileViewStatus
  file?: SessionFile | undefined
  error?: string | undefined
  onBack: () => void
  onRetry: () => void
}
