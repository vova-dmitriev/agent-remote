import type { ReactNode } from "react"
import type { AttachmentAccess } from "@/shared/api"

export interface AttachmentProviderProps {
  access: AttachmentAccess | undefined
  children: ReactNode
}
