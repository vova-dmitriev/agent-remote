import type { Session } from "@protocol"

export interface SlashSkillsInput {
  session: Session
  prompt: string
  disabled: boolean
  setPrompt: (text: string) => void
}
