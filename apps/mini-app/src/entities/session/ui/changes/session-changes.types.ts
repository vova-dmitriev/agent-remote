import type { SessionChanges } from "@protocol"

export interface SessionChangesProps {
  changes?: SessionChanges | undefined
  /** Opens a changed file as it is now; absent where files cannot be read. */
  onOpen?: ((path: string) => void) | undefined
}
