import { createContext } from "react"
import type { AttachmentAccess } from "@/shared/api"

export const AttachmentContext = createContext<AttachmentAccess | undefined>(undefined)
