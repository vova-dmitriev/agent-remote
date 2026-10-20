import { Check, FilePen, FileText, Globe, LoaderCircle, Search, Terminal, Wrench, X, type LucideIcon } from "lucide-react"
import { ActivityKind, ToolActivityPhase } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { cn } from "@/shared/lib/utils"
import { TOOL_ACTIVITY_IDS } from "@/pages/session/config/test-ids"
import type { ToolActivityLineProps } from "./tool-activity-line.types"

const kindIcons: Record<ActivityKind, LucideIcon> = {
  [ActivityKind.Command]: Terminal,
  [ActivityKind.Read]: FileText,
  [ActivityKind.Write]: FilePen,
  [ActivityKind.Search]: Search,
  [ActivityKind.Web]: Globe,
  [ActivityKind.Tool]: Wrench,
}

const phaseIcons: Record<ToolActivityPhase, LucideIcon> = {
  [ToolActivityPhase.Started]: LoaderCircle,
  [ToolActivityPhase.Completed]: Check,
  [ToolActivityPhase.Failed]: X,
}

const phaseLabels = {
  [ToolActivityPhase.Started]: "toolRunning",
  [ToolActivityPhase.Completed]: "toolCompleted",
  [ToolActivityPhase.Failed]: "toolFailed",
} as const

const phaseClass: Record<ToolActivityPhase, string> = {
  [ToolActivityPhase.Started]: "animate-spin text-status-busy motion-reduce:animate-none",
  [ToolActivityPhase.Completed]: "text-status-ready",
  [ToolActivityPhase.Failed]: "text-danger",
}

/** One tool call of a transcript as a compact line: kind, tool name, input summary and outcome. Output is never shown. */
export function ToolActivityLine({ id, tool, detail }: ToolActivityLineProps) {
  const { t } = useTranslation()
  const KindIcon = kindIcons[tool.kind ?? ActivityKind.Tool]
  const PhaseIcon = phaseIcons[tool.phase]

  return (
    <div
      className="mb-[6px] flex min-w-0 items-center gap-[8px] rounded-[8px] border border-border bg-surface px-[10px] py-[6px] text-[12px] text-muted-foreground"
      data-testid={TOOL_ACTIVITY_IDS.root}
      data-message-id={id}
      data-tool-phase={tool.phase}
      data-tool-kind={tool.kind ?? ActivityKind.Tool}
    >
      <KindIcon className="flex-none" size={14} aria-hidden="true" />
      <span className="flex-none font-medium text-foreground" data-testid={TOOL_ACTIVITY_IDS.name}>
        {tool.name ?? t("toolCall")}
      </span>
      {detail ? (
        <span className="min-w-0 flex-1 truncate font-mono" data-testid={TOOL_ACTIVITY_IDS.detail} title={detail}>
          {detail}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      <PhaseIcon
        className={cn("flex-none", phaseClass[tool.phase])}
        size={14}
        role="img"
        aria-label={t(phaseLabels[tool.phase])}
        data-testid={TOOL_ACTIVITY_IDS.phase}
      />
    </div>
  )
}
