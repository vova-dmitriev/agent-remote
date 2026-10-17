import type { RenameSessionController } from "../model/use-rename-session"

export interface SessionTitleProps {
  title: string
  controller: RenameSessionController
  disabled: boolean
}
