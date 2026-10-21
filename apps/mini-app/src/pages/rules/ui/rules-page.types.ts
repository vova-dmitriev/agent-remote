import type { ReactNode } from "react"
import type { ReadyRule, Session } from "@protocol"
import type { RulesTabData } from "../lib/tabs"
import type { OwnRuleController } from "../model/use-own-rule"

export interface RulesPageProps {
  deviceId: string
  online: boolean
  /** The session the page was opened from: its tab comes first. */
  session: Session | null
  onBack: () => void
}

export interface RulesTabProps {
  tab: RulesTabData
  busy: boolean
  onToggle: (ready: ReadyRule, on: boolean) => void
  onRemove: (id: string) => void
  onForget: (command: string) => void
  /** The own-rule form, below the own rules. */
  children?: ReactNode
}

export interface OwnRuleFormProps {
  controller: OwnRuleController
}
