import type { SessionSkill } from "@protocol"

export interface SkillsMenuProps {
  listId: string
  items: readonly SessionSkill[]
  active: number
  loading: boolean
  failed: boolean
  supported: boolean
  truncated: boolean
  pick: (skill: SessionSkill) => void
  highlight: (index: number) => void
  retry: () => void
}
