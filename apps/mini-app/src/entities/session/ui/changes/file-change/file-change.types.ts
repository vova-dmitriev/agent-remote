import type { SessionFileChange } from "@protocol"

export interface FileChangeProps {
  file: SessionFileChange
  /** Opens the file as it is now; absent where files cannot be read, and for a deleted file. */
  onOpen?: ((path: string) => void) | undefined
}
