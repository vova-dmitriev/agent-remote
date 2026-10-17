import { AttachmentContext } from "../model/access-context"
import type { AttachmentProviderProps } from "../model/types/attachment-provider.types"

export function AttachmentProvider({ access, children }: AttachmentProviderProps) {
  return <AttachmentContext.Provider value={access}>{children}</AttachmentContext.Provider>
}
