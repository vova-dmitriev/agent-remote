import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SHELL_IDS } from "../config/test-ids"
import { ShellHeader } from "./header/shell-header"
import type { DesktopHeaderProps } from "./application-shell.types"

/** Full-width desktop app bar: the shell header plus the sidebar toggle. */
export function DesktopHeader({ sidebarCollapsed, onToggleSidebar, ...header }: DesktopHeaderProps) {
  const { t } = useTranslation()
  const label = t(sidebarCollapsed ? "sidebarExpand" : "sidebarCollapse")

  return (
    <ShellHeader
      {...header}
      className="h-12 shrink-0 border-b border-border bg-card px-3"
      leading={
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label={label}
          aria-expanded={!sidebarCollapsed}
          title={label}
          data-testid={SHELL_IDS.sidebarToggle}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </Button>
      }
    />
  )
}
