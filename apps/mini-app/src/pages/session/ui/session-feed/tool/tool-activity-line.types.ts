import type { ToolActivity } from "@protocol"

export interface ToolActivityLineProps {
  id: string
  tool: ToolActivity
  /** Bounded input summary of the call (command, path, URL, query or prompt). */
  detail: string
}
