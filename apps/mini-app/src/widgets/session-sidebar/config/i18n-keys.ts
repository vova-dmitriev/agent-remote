import type { MessageKey } from "@/shared/lib/i18n"
import { SidebarGroup } from "./values"

export const sidebarGroupLabels: Record<SidebarGroup, MessageKey> = {
  [SidebarGroup.Today]: "sidebarToday",
  [SidebarGroup.Yesterday]: "sidebarYesterday",
  [SidebarGroup.Earlier]: "sidebarEarlier",
}
