import type { SubagentInfo } from "@protocol"

export interface SubagentPanelProps {
  agents?: SubagentInfo[]
  online: boolean
  /** Opens a subagent's read-only view; rows are not clickable without it. */
  onOpen?: ((agentId: string) => void) | undefined
}
